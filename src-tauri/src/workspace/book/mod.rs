// 图书工作区子模块聚合：数据 / 模板 / 目录树搜索 / 文件 ops / 归档 / Tauri 命令。

pub(crate) mod archive;
pub(crate) mod commands;
pub(crate) mod data;
pub(crate) mod ops;
pub(crate) mod templates;
pub(crate) mod tree;

#[cfg(test)]
mod tests;

pub(crate) use data::run_book_migrations;
