// 图书工作区子模块聚合：真实文件存储 / 索引库 / 模板 / 目录树 / 文件 ops / 归档 / Tauri 命令。

pub(crate) mod archive;
pub(crate) mod commands;
pub(crate) mod data;
pub(crate) mod fs_store;
pub(crate) mod index_schema;
pub(crate) mod maintenance;
pub(crate) mod ops;
pub(crate) mod relations;
pub(crate) mod search;
pub(crate) mod session_store;
pub(crate) mod templates;
pub(crate) mod tree;

#[cfg(test)]
mod tests;
