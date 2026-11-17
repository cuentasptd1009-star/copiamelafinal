"""Keep the encoder below the API's priority and stop it if its parent dies."""
import ctypes
import os
import signal
import sys

if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "Cannot set parent-death signal")
if os.getppid() != int(sys.argv[1]):
    raise SystemExit(1)
os.nice(10)
os.execvp(sys.argv[2], sys.argv[2:])
