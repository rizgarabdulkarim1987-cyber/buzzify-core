# Buzzify print bridge

A web page cannot talk to a printer directly. This program runs on the till PC and forwards the till's print jobs to the printer. It works with any ESC/POS thermal printer (Epson, Star, Xprinter, Rongta, Bixolon and others) because it passes raw bytes through.

## Install

1. Install Node.js 20 or newer on the till PC.
2. Copy this folder to the PC.
3. Edit `start-bridge.cmd` so `--origin` is the address you open the till at.
4. Double-click `start-bridge.cmd`. Leave the window open. To start it with Windows, put a shortcut to the file in the Startup folder (`Win+R`, then `shell:startup`).

The bridge listens on `http://127.0.0.1:9101` (this PC only) and accepts jobs only from the origin you gave it.

## Connect a printer

- **Network printer:** give it a fixed IP address (from its menu or your router). In the till's Settings, add a printer with type Network and address `192.168.1.50:9100`.
- **USB printer:** install the printer in Windows, then share it (Printer properties, Sharing) with a short name such as `XP80`. In the till's Settings, add a printer with type File and address `\\localhost\XP80`.

Use the Test print button in Settings to check each printer.
