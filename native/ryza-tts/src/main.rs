use std::io::{self, BufRead, Write};

use ryza_tts::{EngineHost, Request};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    let mut engine = EngineHost::default();

    for line in stdin.lock().lines() {
        let response = match line {
            Ok(value) if value.len() <= 128 * 1024 => match serde_json::from_str::<Request>(&value)
            {
                Ok(request) => engine.handle(request),
                Err(error) => {
                    let fallback = format!(
                        "{{\"id\":\"\",\"ok\":false,\"error\":{{\"code\":\"INVALID_REQUEST\",\"message\":{}}}}}",
                        serde_json::to_string(&error.to_string()).unwrap()
                    );
                    writeln!(stdout, "{fallback}").ok();
                    stdout.flush().ok();
                    continue;
                }
            },
            Ok(_) => {
                writeln!(stdout, "{{\"id\":\"\",\"ok\":false,\"error\":{{\"code\":\"INVALID_REQUEST\",\"message\":\"request exceeds 128 KiB\"}}}}").ok();
                stdout.flush().ok();
                continue;
            }
            Err(_) => break,
        };
        match serde_json::to_string(&response) {
            Ok(json) => {
                writeln!(stdout, "{json}").ok();
            }
            Err(error) => {
                eprintln!("response serialization failed: {error}");
            }
        }
        if stdout.flush().is_err() {
            break;
        }
    }
}
