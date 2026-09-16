"""FireAI core package.

Holds infrastructure shared by the control process, the local API server and
the cloud bridge. Modules here must not import Flask, FastAPI or any hardware
library at import time.
"""
