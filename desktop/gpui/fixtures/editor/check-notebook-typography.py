#!/usr/bin/env python3
"""Read-only diagnostic on a new owned display, never the user's desktop."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

output=Path(os.environ.get("TWYNE_NOTEBOOK_TYPOGRAPHY_OUTPUT","/tmp/twyne-notebook-typography"))
output.mkdir(parents=True,exist_ok=True)
probe=Path(__file__).resolve().parents[2]/"target/debug/examples/twyne-clipboard-probe"
html=(Path(__file__).resolve().parent.parent/"marginalia/browser-manuscript.html").read_text()
xvfb=subprocess.Popen([shutil.which("Xvfb"),"-displayfd","1","-screen","0","900x900x24","-nolisten","tcp"],stdout=subprocess.PIPE,stderr=(output/"xvfb.log").open("wb"))
process=None
try:
    display=":"+xvfb.stdout.readline().decode().strip()
    assert display != ":"
    env={**os.environ,"DISPLAY":display,"XDG_RUNTIME_DIR":str(output),"GPUI_X11_SCALE_FACTOR":"1"}
    env.pop("WAYLAND_DISPLAY",None)
    env.pop("GPUI_HEADLESS",None)
    if env.get("TWYNE_GPUI_RENDER_ICD"):
        env["VK_DRIVER_FILES"]=env["TWYNE_GPUI_RENDER_ICD"]
    for width in (704,554):
        config=output/f"native-config-{width}.json"
        result=output/f"native-{width}.json"
        ready=output/f"native-{width}.ready"
        release=output/f"native-{width}.release"
        ready.unlink(missing_ok=True)
        release.unlink(missing_ok=True)
        config.write_text(json.dumps({"html":html,"width":width,"output":str(result),"ready":str(ready),"release":str(release)}))
        process=subprocess.Popen([str(probe),"typography",display,str(config)],env=env,stdout=(output/f"native-{width}.stdout").open("wb"),stderr=(output/f"native-{width}.stderr").open("wb"))
        deadline=time.monotonic()+12
        while not ready.exists():
            assert process.poll() is None,(output/f"native-{width}.stderr").read_text()
            assert time.monotonic()<deadline,"Owned native geometry did not become ready"
            time.sleep(0.015)
        subprocess.run([shutil.which("import"),"-display",display,"-window","root",str(output/f"native-{width}.png")],env=env,capture_output=True,check=True,timeout=8)
        release.write_text("captured")
        process.wait(timeout=15)
        assert process.returncode==0,(output/f"native-{width}.stderr").read_text()
        report=json.loads(result.read_text())
        assert report["html_unchanged"] and report["backend"]=="X11"
        opening=[line["text"] for line in report["paragraphs"][1]["lines"]]
        expected={
            704:[
                "The notebook was small enough to carry in a coat pocket. By ",
                "November, its corners had softened and the cover had begun to remem",
                "ber the shape of a hand.",
            ],
            554:[
                "The notebook was small enough to carry in a coat ",
                "pocket. By November, its corners had softened and ",
                "the cover had begun to remember the shape of a ",
                "hand.",
            ],
        }
        assert opening==expected[width],(width,opening)
        expected_bounds={704:[(88,66.4),(172.4,97.2),(277.7,64.8),(378.5,30),(418.1,32.4)],554:[(88,66.4),(172.4,129.6),(310.1,97.2),(443.3,30),(482.9,64.8)]}
        for paragraph,(top,height) in zip(report["paragraphs"],expected_bounds[width],strict=True):
            bounds=paragraph["bounds"]
            assert abs(bounds["y"]-top)<0.02 and abs(bounds["height"]-height)<0.02,(width,bounds,top,height)
        print(json.dumps({"width":width,"lines":[[line["text"] for line in block["lines"]] for block in report["paragraphs"]],"bounds":[block["bounds"] for block in report["paragraphs"]],"measures":report["measures"][:3],"dictionary":report["dictionary_remember"]}))
finally:
    if process and process.poll() is None:
        process.terminate();process.wait(timeout=3)
    xvfb.terminate();xvfb.wait(timeout=3)
