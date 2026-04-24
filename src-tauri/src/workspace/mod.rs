// 工作区根模块：图书工作区（book）+ 扩写模式（expansion），共享 common 工具。

pub(crate) mod common;
pub mod book;
pub mod expansion;

// 兼容旧路径：lib.rs 与 data_management 仍以 `workspace::xxx` 引用 Tauri 命令。
pub use book::commands::*;

// 提供给 db.rs 的迁移入口。
pub(crate) use book::run_book_migrations as run_workspace_migrations;
pub(crate) use expansion::run_expansion_migrations;
