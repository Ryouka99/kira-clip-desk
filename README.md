# Kira Clip Desk

A human-first batch viewer for public Medal links and local video files. It does not run automatic Kira detection or save clips in browser storage.

## Run

Install the Python dependency, then start the local server:

```powershell
python -m pip install -r requirements.txt
python server.py
```

Open http://127.0.0.1:8000. The Medal resolver accepts public links in the `/games/<game>/clips/<clip-id>` format and resolves stream URLs without downloading entire clips first. There is no total batch limit; six links resolve at a time and the rest wait. The service also caps active resolutions at six across all visitors.

## Public Hosting

The included `render.yaml` is a Render Blueprint. Push the project to a Git repository, then create a Blueprint in Render from that repository. Render will build the Python service and provide a public URL. The `.gitignore` keeps uploaded clips and experimental model weights out of the repository.