use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn collect_text_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];

    while let Some(current) = pending.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.push(path);
            }
        }
    }

    files.sort();
    files
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn build_embedded_const(root: &Path, const_name: &str) -> String {
    let mut lines = Vec::new();
    lines.push(format!("pub const {const_name}: &[EmbeddedTextFile] = &["));

    for file in collect_text_files(root) {
        let absolute = file.canonicalize().unwrap_or(file.clone());
        let relative = file
            .strip_prefix(root)
            .expect("embedded resource should stay inside root");
        let relative_path = normalize_path(relative);
        let absolute_path = normalize_path(&absolute);
        lines.push(format!(
            "    EmbeddedTextFile {{ path: {:?}, content: include_str!(r#\"{}\"#) }},",
            relative_path, absolute_path
        ));
    }

    lines.push("];".to_string());
    lines.join("\n")
}

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=resources/skills");
    println!("cargo:rerun-if-changed=resources/agents");
    println!("cargo:rerun-if-changed=resources/workflows");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing manifest dir"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("missing out dir"));
    let generated_file = out_dir.join("embedded_resources.rs");

    let skills_root = manifest_dir.join("resources").join("skills");
    let agents_root = manifest_dir.join("resources").join("agents");
    let workflows_root = manifest_dir.join("resources").join("workflows");

    let contents = format!(
        "pub struct EmbeddedTextFile {{\n    pub path: &'static str,\n    pub content: &'static str,\n}}\n\n{}\n\n{}\n\n{}\n",
        build_embedded_const(&skills_root, "EMBEDDED_SKILL_FILES"),
        build_embedded_const(&agents_root, "EMBEDDED_AGENT_FILES"),
        build_embedded_const(&workflows_root, "EMBEDDED_WORKFLOW_FILES")
    );

    fs::write(generated_file, contents).expect("failed to write embedded resources");
    tauri_build::build()
}
