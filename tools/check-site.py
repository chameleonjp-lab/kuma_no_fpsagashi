#!/usr/bin/env python3
"""Validate the single-file release and optionally stage only its public file."""
import argparse
import json
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts = []
        self.current = None
        self.local_assets = []
        self.ids = set()

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                raise ValueError('Duplicate HTML id: ' + attrs['id'])
            self.ids.add(attrs['id'])
        for attr in ('src', 'poster'):
            if attrs.get(attr):
                self.check_asset(attrs[attr])
        if tag == 'link' and attrs.get('rel') in ('stylesheet', 'icon', 'manifest', 'preload', 'modulepreload'):
            self.check_asset(attrs.get('href', ''))
        if tag == 'script':
            self.current = (attrs, [])

    def check_asset(self, value):
        url = urlsplit(value)
        if url.path and not url.scheme and not url.netloc:
            self.local_assets.append(value)

    def handle_data(self, text):
        if self.current:
            self.current[1].append(text)

    def handle_endtag(self, tag):
        if tag == 'script' and self.current:
            self.scripts.append(self.current)
            self.current = None


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--out', type=Path)
    options = args.parse_args()
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    if '<html' not in html.lower() or '</html>' not in html.lower():
        raise ValueError('index.html is not a complete HTML document')
    page = Page()
    page.feed(html)
    if page.local_assets:
        raise ValueError('Release manifest must be extended for local assets: ' + ', '.join(page.local_assets))
    checked = 0
    with tempfile.TemporaryDirectory() as temp:
        for i, (attrs, chunks) in enumerate(page.scripts):
            if attrs.get('src'):
                continue
            kind = attrs.get('type', '').lower()
            source = ''.join(chunks)
            if kind in ('importmap', 'application/ld+json', 'application/json'):
                json.loads(source)
            elif kind in ('', 'module', 'text/javascript', 'application/javascript'):
                script = Path(temp) / ('script-' + str(i) + ('.mjs' if kind == 'module' else '.js'))
                script.write_text(source, encoding='utf-8')
                subprocess.run(['node', '--check', str(script)], check=True)
                checked += 1
    if checked == 0:
        raise ValueError('No executable game script found')
    if options.out:
        output = options.out.resolve()
        if output == ROOT or ROOT not in output.parents or output.name != '_site':
            raise ValueError('Output must be the repository-local _site directory')
        if output.exists():
            shutil.rmtree(output)
        output.mkdir()
        shutil.copy2(ROOT / 'index.html', output / 'index.html')
        (output / '.nojekyll').touch()
    print(f'Validated index.html: {checked} JavaScript blocks; single-file public release')


if __name__ == '__main__':
    main()
