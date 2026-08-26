from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "test-product" / "supervision.test.mjs"
text = path.read_text(encoding="utf-8")
old = "writeFileSync(script, \"import { spawn } from 'node:child_process'; spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});\\n\");"
new = "writeFileSync(script, \"import { spawn } from 'node:child_process'; const child = spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'}); child.unref();\\n\");"
if old not in text:
    raise SystemExit("descendant test patch target not found")
path.write_text(text.replace(old, new), encoding="utf-8")
print("True leaked-descendant regression applied")
