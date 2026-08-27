mod constants;
mod container;
mod crypto;
mod error;
mod format;
mod manifest;
mod vector;

use std::{env, fs, path::PathBuf};

use serde::Serialize;
use zeroize::Zeroizing;

use crate::{
    container::{decrypt_file, inspect_authenticated, inspect_public},
    error::{Bec1Error, Result},
    manifest::RecoveryManifest,
    vector::emit_vector,
};

const USAGE: &str = "Usage:\n  bec1-interop inspect <container.bbec> [--password-file <path>]\n  bec1-interop decrypt <container.bbec> <output> --password-file <path>\n  bec1-interop emit-vector <vector-json> <output>";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecryptOutput {
    output_path: String,
    recovery: RecoveryManifest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitOutput {
    output_path: String,
}

#[derive(Serialize)]
struct ErrorOutput<'a> {
    code: &'a str,
    message: &'a str,
}

fn main() {
    if let Err(error) = run() {
        let output = ErrorOutput {
            code: error.code,
            message: &error.message,
        };
        eprintln!(
            "{}",
            serde_json::to_string(&output).unwrap_or_else(|_| {
                "{\"code\":\"INTERNAL_ERROR\",\"message\":\"Unable to encode error.\"}".to_owned()
            })
        );
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    match arguments.first().map(String::as_str) {
        Some("inspect") => run_inspect(&arguments[1..]),
        Some("decrypt") => run_decrypt(&arguments[1..]),
        Some("emit-vector") => run_emit_vector(&arguments[1..]),
        _ => Err(Bec1Error::new("INVALID_INPUT", USAGE)),
    }
}

fn run_inspect(arguments: &[String]) -> Result<()> {
    let parsed = parse_arguments(arguments)?;
    if parsed.positional.len() != 1 {
        return Err(Bec1Error::new("INVALID_INPUT", USAGE));
    }
    let input_path = PathBuf::from(&parsed.positional[0]);
    if let Some(password_file) = parsed.password_file {
        let password = read_password(&password_file)?;
        print_json(&inspect_authenticated(&input_path, &password)?)
    } else {
        print_json(&inspect_public(&input_path)?)
    }
}

fn run_decrypt(arguments: &[String]) -> Result<()> {
    let parsed = parse_arguments(arguments)?;
    if parsed.positional.len() != 2 {
        return Err(Bec1Error::new("INVALID_INPUT", USAGE));
    }
    let password_file = parsed
        .password_file
        .ok_or_else(|| Bec1Error::new("INVALID_INPUT", "decrypt requires --password-file."))?;
    let password = read_password(&password_file)?;
    let input_path = PathBuf::from(&parsed.positional[0]);
    let output_path = PathBuf::from(&parsed.positional[1]);
    let recovery = decrypt_file(&input_path, &output_path, &password)?;
    print_json(&DecryptOutput {
        output_path: output_path.to_string_lossy().into_owned(),
        recovery,
    })
}

fn run_emit_vector(arguments: &[String]) -> Result<()> {
    let parsed = parse_arguments(arguments)?;
    if parsed.positional.len() != 2 || parsed.password_file.is_some() {
        return Err(Bec1Error::new("INVALID_INPUT", USAGE));
    }
    let vector_path = PathBuf::from(&parsed.positional[0]);
    let output_path = PathBuf::from(&parsed.positional[1]);
    emit_vector(&vector_path, &output_path)?;
    print_json(&EmitOutput {
        output_path: output_path.to_string_lossy().into_owned(),
    })
}

struct ParsedArguments {
    positional: Vec<String>,
    password_file: Option<PathBuf>,
}

fn parse_arguments(arguments: &[String]) -> Result<ParsedArguments> {
    let mut positional = Vec::new();
    let mut password_file = None;
    let mut index = 0;
    while index < arguments.len() {
        if arguments[index] == "--password-file" {
            let value = arguments.get(index + 1).ok_or_else(|| {
                Bec1Error::new("INVALID_INPUT", "--password-file requires a path.")
            })?;
            if password_file.replace(PathBuf::from(value)).is_some() {
                return Err(Bec1Error::new(
                    "INVALID_INPUT",
                    "--password-file may be provided only once.",
                ));
            }
            index += 2;
            continue;
        }
        if arguments[index].starts_with("--") {
            return Err(Bec1Error::new(
                "INVALID_INPUT",
                format!("Unknown option: {}", arguments[index]),
            ));
        }
        positional.push(arguments[index].clone());
        index += 1;
    }
    Ok(ParsedArguments {
        positional,
        password_file,
    })
}

fn read_password(path: &PathBuf) -> Result<Zeroizing<String>> {
    let mut password = Zeroizing::new(fs::read_to_string(path)?);
    if password.ends_with("\r\n") {
        let stripped_length = password.len() - 2;
        password.truncate(stripped_length);
    } else if password.ends_with('\n') {
        password.pop();
    }
    Ok(password)
}

fn print_json(value: &impl Serialize) -> Result<()> {
    let output = serde_json::to_string_pretty(value)?;
    println!("{output}");
    Ok(())
}
