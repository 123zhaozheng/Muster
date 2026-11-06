"""Generate all mockups listed in prompts.json concurrently.

Usage: python -I gen_mockups.py <prompts.json> <out_dir> [name ...]
Reads the API key from IMAGE_API_KEY. Skips screens whose PNG already exists.
"""
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

prompts_path, out_dir = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
gen = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen_image.py")

with open(prompts_path, encoding="utf-8") as f:
    spec = json.load(f)


def run(item):
    name, prompt = item
    out = os.path.join(out_dir, f"{name}.png")
    if os.path.exists(out):
        return f"{name}: exists"
    size = "1536x1024"
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as t:
        t.write(f"{prompt}\n\n{spec['style']}")
    r = subprocess.run([sys.executable, "-I", gen, t.name, out, size], capture_output=True, text=True)
    os.unlink(t.name)
    return f"{name}: {'ok' if r.returncode == 0 else 'FAIL ' + r.stderr[-400:]}"


items = [(k, v) for k, v in spec["screens"].items() if not only or k in only]
with ThreadPoolExecutor(max_workers=8) as pool:
    for line in pool.map(run, items):
        print(line, flush=True)
