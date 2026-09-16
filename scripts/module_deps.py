#!/usr/bin/env python3
"""Print the union of hardware-module Python dependencies from the wizard manifest, one per line.

Used by deploy/install.sh so every probe/display/platform module is usable
without a per-module install step (the legacy wizard installed them lazily).
"""
import json
import sys

manifest = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'wizard/wizard_manifest.json'))
deps: set[str] = set()
for kind in ('grillplatform', 'display', 'distance', 'probes'):
    for module in manifest['modules'][kind].values():
        deps.update(module.get('py_dependencies', []))
# Already provided by the core install; skip duplicates/conflicts.
skip_prefixes = ('pillow', 'paho-mqtt', 'cryptography', 'gpiozero', 'rpi-hardware-pwm', 'icecream')
for dep in sorted(deps):
    if dep.lower().startswith(skip_prefixes):
        continue
    print(dep)
