mod builtin;
pub(crate) mod commands;
mod db;
mod management;
mod package_export;
mod repository;
mod types;
mod validate;

pub(crate) use db::run_workflow_migrations;
pub(crate) type CommandResult<T> = Result<T, String>;
pub(crate) const WORKFLOW_SOURCE_BUILTIN: &str = "builtin-package";
pub(crate) const WORKFLOW_SOURCE_INSTALLED: &str = "installed-package";
pub(crate) const WORKFLOW_PRIMARY_FILES: [&str; 2] = ["manifest.json", "WORKFLOW.json"];
