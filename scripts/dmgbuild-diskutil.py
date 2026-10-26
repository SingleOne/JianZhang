"""dmgbuild settings adapter for macOS 27's diskutil image interface."""

import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile

import dmgbuild.core as core


mount_points = {}


def diskutil(*args):
    result = subprocess.run(
        ["/usr/sbin/diskutil", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.stderr:
        sys.stderr.buffer.write(result.stderr)
        sys.stderr.buffer.flush()
    return result.returncode, result.stdout


def eject(device, mount_point, force=False):
    if force:
        diskutil("unmountDisk", "force", device)
    ret, output = diskutil("eject", device)
    if ret:
        sys.stderr.buffer.write(output)
        sys.stderr.buffer.flush()
    elif mount_point and Path(mount_point).exists():
        Path(mount_point).rmdir()
    return ret, output


def image_operation(command, *args, **kwargs):
    """Keep dmgbuild's result contract while replacing its image operations."""
    if command == "create":
        image_path = Path(args[-1])
        # dmgbuild reserves the name with NamedTemporaryFile; diskutil needs a new path.
        image_path.unlink(missing_ok=True)
        size = args[args.index("-size") + 1]
        # hdiutil's K/M/G units are binary; diskutil's plain units are decimal.
        size = re.sub(r"(?i)([kmgtpe])$", r"\1iB", size)
        ret, output = diskutil(
            "image", "create", "blank", "--format", "RAW", "--size", size,
            "--volumeName", args[args.index("-volname") + 1],
            "-fs", "APFS", str(image_path),
        )
    elif command == "attach":
        mount_point = tempfile.mkdtemp(prefix="jianzhang-dmg-")
        ret, output = diskutil(
            "image", "attach", "--nobrowse", "--mountOptions", "noowners",
            "--mountPoint", mount_point, args[-1],
        )
        if ret:
            if os.path.ismount(mount_point):
                eject(mount_point, mount_point)
            else:
                Path(mount_point).rmdir()
            return ret, output.decode(errors="replace")
        ret, output = diskutil("info", "-plist", mount_point)
        if ret:
            eject(mount_point, mount_point)
            return ret, output.decode(errors="replace")
        try:
            device = plistlib.loads(output)["DeviceNode"]
        except Exception:
            eject(mount_point, mount_point)
            raise
        mount_points[device] = mount_point
        return 0, {"system-entities": [{"dev-entry": device, "mount-point": mount_point}]}
    elif command == "detach":
        device = args[-1]
        ret, output = eject(device, mount_points.get(device), force="-force" in args)
        if ret == 0:
            mount_points.pop(device, None)
    elif command == "resize":
        ret, output = diskutil("image", "resize", "--size", "min", args[-1])
    elif command == "convert":
        image_path = Path(args[args.index("-o") + 1])
        if "-ov" in args:
            image_path.unlink(missing_ok=True)
        ret, output = diskutil(
            "image", "create", "from", "--format", args[args.index("-format") + 1],
            args[0], str(image_path),
        )
    else:
        raise ValueError(f"Unsupported disk image operation: {command}")

    if ret or not kwargs.get("plist", True):
        return ret, output.decode(errors="replace")
    return 0, {}


core.hdiutil = image_operation
core.load_json(os.environ["JIANZHANG_DMG_SETTINGS"], globals())
# diskutil image creates APFS volumes; the previous default HFS+ is unsupported.
filesystem = "APFS"
