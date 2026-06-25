import sys
import json
import ctypes
from ctypes import wintypes

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800

def run():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            action = cmd.get("action")
            
            if action == "move":
                if "dx" in cmd and "dy" in cmd:
                    pt = wintypes.POINT()
                    ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
                    ctypes.windll.user32.SetCursorPos(int(pt.x + cmd["dx"]), int(pt.y + cmd["dy"]))
                else:
                    x, y = cmd.get("x", 0), cmd.get("y", 0)
                    ctypes.windll.user32.SetCursorPos(int(x), int(y))
                
            elif action == "press":
                btn = cmd.get("button", "left")
                down = MOUSEEVENTF_LEFTDOWN if btn == "left" else MOUSEEVENTF_RIGHTDOWN
                ctypes.windll.user32.mouse_event(down, 0, 0, 0, 0)
                
            elif action == "release":
                btn = cmd.get("button", "left")
                up = MOUSEEVENTF_LEFTUP if btn == "left" else MOUSEEVENTF_RIGHTUP
                ctypes.windll.user32.mouse_event(up, 0, 0, 0, 0)
                
            elif action == "scroll":
                delta = cmd.get("delta", 0)
                ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(delta * 20), 0)
                
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.stderr.flush()

if __name__ == "__main__":
    run()
