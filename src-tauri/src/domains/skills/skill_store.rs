// 技能存储：真实文件后端（CP-E）。
//
// CP-E 起，技能从 SQLite `skill_packages`(manifest_json+files_json) 改为真实磁盘文件：
//   app_data_dir/skills/<skill_id>/
//     ├─ SKILL.md            技能正文 + frontmatter
//     ├─ references/*.md      参考资料
//     ├─ templates/*          模板
//     └─ .skill-meta.json     {sourceKind, isBuiltin}（区分内置/已安装，不计入技能文件）
//
// 这样 pi 的 loadSkills(env, dir) 能直接遍历该目录读取 SKILL.md，无需自研注入。
// SkillStore 是唯一存储入口；技能内容以 SkillFiles(相对路径→内容) 形态进出，
// 与现有 build_skill_manifest_from_files 的输入契约保持一致（迁移只换"内容存哪"）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, String>;
type SkillFiles = HashMap<String, String>;

/// 技能内部保留文件名（不计入 SkillFiles，也不被 loadSkills 当作技能内容）。
pub(crate) const SKILL_META_FILE: &str = ".skill-meta.json";

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn validate_skill_id(skill_id: &str) -> CommandResult<&str> {
    let trimmed = skill_id.trim();
    if trimmed != skill_id
        || trimmed.is_empty()
        || trimmed.len() > 64
        || trimmed.starts_with('-')
        || trimmed.ends_with('-')
        || trimmed.contains("--")
        || !trimmed
            .chars()
            .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-')
    {
        return Err("技能 ID 不合法。".into());
    }
    Ok(trimmed)
}

/// 技能元信息，序列化到 <skill_id>/.skill-meta.json。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMeta {
    pub(crate) source_kind: String,
    pub(crate) is_builtin: bool,
}

/// 真实文件技能存储。skills_root 之下每个子目录是一个技能（目录名 = skill_id）。
#[derive(Clone)]
pub(crate) struct SkillStore {
    skills_root: PathBuf,
}

impl SkillStore {
    pub(crate) fn new(skills_root: PathBuf) -> Self {
        Self { skills_root }
    }

    /// 从 AppHandle 构造：skills 根 = app_data_dir/skills。
    pub(crate) fn from_app(app: &AppHandle) -> CommandResult<Self> {
        let skills_root = app
            .path()
            .app_data_dir()
            .map_err(error_to_string)?
            .join("skills");
        fs::create_dir_all(&skills_root).map_err(error_to_string)?;
        Ok(Self::new(skills_root))
    }

    pub(crate) fn skill_dir(&self, skill_id: &str) -> CommandResult<PathBuf> {
        Ok(self.skills_root.join(validate_skill_id(skill_id)?))
    }

    fn meta_path(&self, skill_id: &str) -> CommandResult<PathBuf> {
        Ok(self.skill_dir(skill_id)?.join(SKILL_META_FILE))
    }

    fn ensure_not_symlink(path: &Path) -> CommandResult<()> {
        if let Ok(metadata) = fs::symlink_metadata(path) {
            if metadata.file_type().is_symlink() {
                return Err("不能操作符号链接。".into());
            }
        }
        Ok(())
    }

    /// 把技能内相对路径安全解析为绝对路径，拒绝 .. 越界与绝对路径。
    fn resolve_abs(&self, skill_id: &str, relative_path: &str) -> CommandResult<PathBuf> {
        let normalized = relative_path.replace('\\', "/");
        let mut abs = self.skill_dir(skill_id)?;
        for component in Path::new(&normalized).components() {
            match component {
                Component::Normal(segment) => abs.push(segment),
                Component::CurDir => {}
                _ => return Err("技能文件路径不合法。".into()),
            }
        }
        Ok(abs)
    }

    pub(crate) fn exists(&self, skill_id: &str) -> bool {
        self.skill_dir(skill_id)
            .map(|dir| dir.is_dir())
            .unwrap_or(false)
    }

    pub(crate) fn write_meta(&self, skill_id: &str, meta: &SkillMeta) -> CommandResult<()> {
        let dir = self.skill_dir(skill_id)?;
        fs::create_dir_all(&dir).map_err(error_to_string)?;
        let json = serde_json::to_string_pretty(meta).map_err(error_to_string)?;
        fs::write(self.meta_path(skill_id)?, json).map_err(error_to_string)
    }

    pub(crate) fn read_meta(&self, skill_id: &str) -> CommandResult<Option<SkillMeta>> {
        match fs::read(self.meta_path(skill_id)?) {
            Ok(raw) => serde_json::from_slice::<SkillMeta>(&raw)
                .map(Some)
                .map_err(error_to_string),
            Err(_) => Ok(None),
        }
    }

    /// 读取某技能全部文件内容（相对路径→内容），跳过内部保留文件。
    pub(crate) fn read_files(&self, skill_id: &str) -> CommandResult<SkillFiles> {
        let dir = self.skill_dir(skill_id)?;
        let mut files = SkillFiles::new();
        if !dir.is_dir() {
            return Ok(files);
        }
        self.collect_files(&dir, &dir, &mut files)?;
        Ok(files)
    }

    fn collect_files(
        &self,
        base: &Path,
        current: &Path,
        files: &mut SkillFiles,
    ) -> CommandResult<()> {
        for entry in fs::read_dir(current).map_err(error_to_string)? {
            let entry = entry.map_err(error_to_string)?;
            let file_type = entry.file_type().map_err(error_to_string)?;
            let path = entry.path();
            if file_type.is_dir() {
                self.collect_files(base, &path, files)?;
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name == SKILL_META_FILE {
                continue;
            }
            let relative = path
                .strip_prefix(base)
                .map_err(error_to_string)?
                .to_string_lossy()
                .replace('\\', "/");
            if let Ok(bytes) = fs::read(&path) {
                // 用统一的 bytes_to_text 解码(支持 BOM/UTF-16/GBK),与书籍文件读取一致,
                // 避免 from_utf8_lossy 把 GBK/带 BOM 的 SKILL.md 解成乱码。
                if let Ok(text) = crate::infrastructure::workspace_paths::bytes_to_text(bytes) {
                    files.insert(relative, text.replace("\r\n", "\n"));
                }
            }
        }
        Ok(())
    }

    /// 覆盖写入某技能的全部文件（先清空目录再写），并落 .skill-meta.json。
    pub(crate) fn write_files(
        &self,
        skill_id: &str,
        files: &SkillFiles,
        meta: &SkillMeta,
    ) -> CommandResult<()> {
        let dir = self.skill_dir(skill_id)?;
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(error_to_string)?;
        }
        fs::create_dir_all(&dir).map_err(error_to_string)?;
        for (relative, content) in files {
            let abs = self.resolve_abs(skill_id, relative)?;
            if let Some(parent) = abs.parent() {
                fs::create_dir_all(parent).map_err(error_to_string)?;
            }
            fs::write(&abs, content).map_err(error_to_string)?;
        }
        self.write_meta(skill_id, meta)
    }

    /// 写入/更新单个文件（保留其余文件），不动 meta。供创建参考文件等单点写入复用。
    #[allow(dead_code)]
    pub(crate) fn write_file(
        &self,
        skill_id: &str,
        relative_path: &str,
        content: &str,
    ) -> CommandResult<()> {
        let abs = self.resolve_abs(skill_id, relative_path)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        fs::write(&abs, content).map_err(error_to_string)
    }

    pub(crate) fn delete(&self, skill_id: &str) -> CommandResult<()> {
        let dir = self.skill_dir(skill_id)?;
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(error_to_string)?;
        }
        Ok(())
    }

    /// 列出所有技能 id（skills_root 下的子目录名）。
    pub(crate) fn list_ids(&self) -> CommandResult<Vec<String>> {
        let mut ids = Vec::new();
        if !self.skills_root.is_dir() {
            return Ok(ids);
        }
        for entry in fs::read_dir(&self.skills_root).map_err(error_to_string)? {
            let entry = entry.map_err(error_to_string)?;
            if entry.file_type().map_err(error_to_string)?.is_dir() {
                ids.push(entry.file_name().to_string_lossy().to_string());
            }
        }
        ids.sort();
        Ok(ids)
    }

    // —— skills_root 相对路径的通用文件访问（供 pi loadSkills 的 ExecutionEnv 转发）——
    // 这些方法以 skills_root 为根，path 相对它；做 .. 越界校验，跳过 .skill-meta.json。

    fn resolve_root_abs(
        &self,
        relative_path: &str,
        include_target: bool,
    ) -> CommandResult<PathBuf> {
        let normalized = relative_path.replace('\\', "/");
        let mut abs = self.skills_root.clone();
        Self::ensure_not_symlink(&abs)?;
        let mut segments = Vec::new();
        for component in Path::new(&normalized).components() {
            match component {
                Component::Normal(segment) => {
                    if segment == SKILL_META_FILE {
                        return Err("技能路径不合法。".into());
                    }
                    segments.push(segment.to_owned());
                }
                Component::CurDir => {}
                _ => return Err("技能路径不合法。".into()),
            }
        }
        for (index, segment) in segments.iter().enumerate() {
            abs.push(segment);
            if include_target || index + 1 < segments.len() {
                Self::ensure_not_symlink(&abs)?;
            }
        }
        Ok(abs)
    }

    pub(crate) fn root_read(&self, relative_path: &str) -> CommandResult<String> {
        let abs = self.resolve_root_abs(relative_path, true)?;
        let bytes = fs::read(&abs).map_err(|_| "技能文件不存在。".to_string())?;
        // 与书籍文件读取一致的解码,避免 GBK/带 BOM 技能文件乱码。
        let text = crate::infrastructure::workspace_paths::bytes_to_text(bytes)?;
        Ok(text.replace("\r\n", "\n"))
    }

    /// 返回路径信息：(kind, size)。kind 为 "file"/"directory"；不存在返回 None。
    pub(crate) fn root_file_info(
        &self,
        relative_path: &str,
    ) -> CommandResult<Option<(String, u64)>> {
        let abs = self.resolve_root_abs(relative_path, true)?;
        match fs::symlink_metadata(&abs) {
            Ok(meta) => {
                let kind = if meta.is_dir() { "directory" } else { "file" };
                Ok(Some((kind.to_string(), meta.len())))
            }
            Err(_) => Ok(None),
        }
    }

    /// 列目录直接子项：(name, isDir, size)。跳过内部保留文件。
    pub(crate) fn root_list_dir(
        &self,
        relative_path: &str,
    ) -> CommandResult<Vec<(String, bool, u64)>> {
        let abs = self.resolve_root_abs(relative_path, true)?;
        if !abs.is_dir() {
            return Ok(Vec::new());
        }
        let mut items = Vec::new();
        for entry in fs::read_dir(&abs).map_err(error_to_string)? {
            let entry = entry.map_err(error_to_string)?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == SKILL_META_FILE {
                continue;
            }
            let file_type = entry.file_type().map_err(error_to_string)?;
            if file_type.is_symlink() {
                continue;
            }
            let size = entry
                .metadata()
                .map(|meta| if meta.is_file() { meta.len() } else { 0 })
                .unwrap_or(0);
            items.push((name, file_type.is_dir(), size));
        }
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_store() -> (SkillStore, TempDir) {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        let skills_root = temp_dir.path().join("skills");
        fs::create_dir_all(&skills_root).expect("skills root should be created");
        (SkillStore::new(skills_root), temp_dir)
    }

    #[test]
    fn root_fs_access_rejects_absolute_paths_and_internal_meta() {
        let (store, _temp_dir) = create_store();

        assert!(store.root_file_info("/outside").is_err());
        assert!(store.root_read("demo/.skill-meta.json").is_err());
    }

    #[test]
    fn root_fs_access_reads_normal_skill_files() {
        let (store, _temp_dir) = create_store();
        let skill_dir = store
            .skill_dir("demo-skill")
            .expect("skill id should be valid");
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
        fs::write(skill_dir.join("SKILL.md"), "# Demo\r\n").expect("skill file should be written");

        let text = store
            .root_read("demo-skill/SKILL.md")
            .expect("skill file should be readable");
        assert_eq!(text, "# Demo\n");
    }

    #[test]
    fn root_list_dir_skips_internal_meta() {
        let (store, _temp_dir) = create_store();
        let skill_dir = store
            .skill_dir("demo-skill")
            .expect("skill id should be valid");
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
        fs::write(skill_dir.join("SKILL.md"), "# Demo").expect("skill file should be written");
        fs::write(skill_dir.join(SKILL_META_FILE), "{}").expect("meta file should be written");

        let names = store
            .root_list_dir("demo-skill")
            .expect("skill dir should list")
            .into_iter()
            .map(|(name, _, _)| name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["SKILL.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn root_fs_access_rejects_symlink_targets() {
        use std::os::unix::fs::symlink;

        let (store, temp_dir) = create_store();
        let skill_dir = store
            .skill_dir("demo-skill")
            .expect("skill id should be valid");
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
        let outside = temp_dir.path().join("outside.md");
        fs::write(&outside, "outside").expect("outside file should be written");
        symlink(&outside, skill_dir.join("SKILL.md")).expect("symlink should be created");

        assert!(store.root_read("demo-skill/SKILL.md").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn root_fs_access_rejects_symlink_targets() {
        use std::os::windows::fs::symlink_file;

        let (store, temp_dir) = create_store();
        let skill_dir = store
            .skill_dir("demo-skill")
            .expect("skill id should be valid");
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
        let outside = temp_dir.path().join("outside.md");
        fs::write(&outside, "outside").expect("outside file should be written");
        if symlink_file(&outside, skill_dir.join("SKILL.md")).is_err() {
            return;
        }

        assert!(store.root_read("demo-skill/SKILL.md").is_err());
    }
}
