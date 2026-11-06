"""Generate one image via the rolldek images endpoint.

Usage: python -I gen_image.py <prompt_file> <out_png> [size]
Reads the API key from the IMAGE_API_KEY environment variable (never stored on disk).
"""
import base64
import json
import os
import sys
import urllib.request

prompt_file, out_png = sys.argv[1], sys.argv[2]
size = sys.argv[3] if len(sys.argv) > 3 else "1536x1024"

with open(prompt_file, encoding="utf-8") as f:
    prompt = f.read()

body = json.dumps({"model": "gpt-image-2.6", "prompt": prompt, "size": size, "n": 1}).encode()
req = urllib.request.Request(
    "https://rolldek.com/v1/images/generations",
    data=body,
    headers={"Authorization": f"Bearer {os.environ['IMAGE_API_KEY']}", "Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=600) as resp:
    data = json.load(resp)["data"][0]

if "b64_json" in data:
    img = base64.b64decode(data["b64_json"])
else:
    with urllib.request.urlopen(data["url"], timeout=120) as r:
        img = r.read()

with open(out_png, "wb") as f:
    f.write(img)
print(out_png, len(img))
