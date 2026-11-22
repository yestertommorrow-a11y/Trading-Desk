"""Build the static coverage page from the project's limited Markdown source."""
from html import escape
from pathlib import Path
import re

root = Path(__file__).resolve().parent
source = (root / "COVERAGE.md").read_text(encoding="utf-8").splitlines()

def inline(s):
    s = escape(s, quote=True)
    return re.sub(r"\[([^\]]+)\]\((https://[^)]+)\)", r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', s)

index, body = 1, []
while index < len(source):
    line = source[index]
    if line.startswith("## "):
        body.append(f"<h2>{inline(line[3:])}</h2>")
    elif line.startswith("- "):
        body.append("<ul>")
        while index < len(source) and source[index].startswith("- "):
            body.append(f"<li>{inline(source[index][2:])}</li>")
            index += 1
        body.append("</ul>")
        continue
    elif line.startswith("|"):
        body.append('<div class="table-scroll"><table class="coverage-table">')
        header = True
        while index < len(source) and source[index].startswith("|"):
            cells = [inline(x.strip()) for x in source[index].strip().strip("|").split("|")]
            tag = "th" if header else "td"
            if not all(re.fullmatch(r"[-: ]+", x) for x in cells):
                body.append("<tr>" + "".join(f"<{tag}>{x}</{tag}>" for x in cells) + "</tr>")
            index += 1
            header = False
        body.append("</table></div>")
        continue
    elif line.strip():
        body.append(f"<p>{inline(line)}</p>")
    index += 1

document = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coverage | Strikebook</title><link rel="stylesheet" href="style.css"><style>.coverage{max-width:1120px;margin:auto;padding:23px clamp(13px,4vw,46px)}.coverage h1{margin:14px 0}.coverage h2{margin:19px 0 6px;font-size:20px}.coverage p,.coverage li{color:var(--sub);margin:6px 0}.coverage-table{border-collapse:collapse;width:100%;min-width:650px;font-size:12px}.coverage-table td,.coverage-table th{padding:10px;border:1px solid var(--line);vertical-align:top;text-align:left}.coverage-table th{background:var(--surface2);color:var(--teal)}.coverage-table td{color:var(--sub)}.coverage-table td:first-child{min-width:125px;color:var(--ink)}</style></head><body><main class="coverage"><a href="./#methods">← Back to Strikebook</a><h1>Market Chameleon workflow coverage</h1>''' + "\n".join(body) + "</main></body></html>\n"
(root / "dist" / "coverage.html").write_text(document, encoding="utf-8")
