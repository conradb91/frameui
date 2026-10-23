#!/usr/bin/python3
"""Local Chrome native messaging bridge. Website data stays on this Mac."""
import sys, os, json, struct, tempfile, subprocess, pathlib, uuid
ROOT=pathlib.Path.home()/'Library/Application Support/FrameUI Chrome Bridge'
INBOX=ROOT/'inbox'
INBOX.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(INBOX,0o700)
def reply(value):
    body=json.dumps(value).encode();sys.stdout.buffer.write(struct.pack('<I',len(body))+body);sys.stdout.buffer.flush()
def read_exact(size):
    out=b''
    while len(out)<size:
        part=sys.stdin.buffer.read(size-len(out))
        if not part: raise EOFError()
        out+=part
    return out
handle=None;temp=None
try:
    while True:
        length=struct.unpack('<I',read_exact(4))[0]
        if length>1024*1024: raise ValueError('Bridge message too large')
        message=json.loads(read_exact(length))
        if message.get('command')=='begin':
            if handle: raise ValueError('A transfer is already running')
            handle=tempfile.NamedTemporaryFile(dir=INBOX,prefix='transfer-',suffix='.part',delete=False);temp=handle.name
            reply({'ok':True})
        elif message.get('command')=='chunk':
            if not handle: raise ValueError('Start a transfer first')
            chunk=message.get('text')
            if not isinstance(chunk,str): raise ValueError('Invalid capture chunk')
            handle.write(chunk.encode('utf-8'));reply({'ok':True})
        elif message.get('command')=='finish':
            if not handle: raise ValueError('Start a transfer first')
            handle.flush();os.fsync(handle.fileno());handle.close();handle=None
            with open(temp) as f: data=json.load(f)
            if data.get('format')!='frameui-chrome-capture' or data.get('version')!=1: raise ValueError('Invalid FrameUI capture')
            target=INBOX/(str(uuid.uuid4())+'.json');os.replace(temp,target);temp=None
            config=json.loads((ROOT/'config.json').read_text());app=config['app']
            if not pathlib.Path(app).is_dir(): raise ValueError('Configured FrameUI app was moved. Install the bridge again.')
            subprocess.run(['/usr/bin/open','-a',app],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            reply({'ok':True,'sent':True});break
        else: raise ValueError('Unknown bridge command')
except EOFError: pass
except Exception as error: reply({'error':str(error)})
finally:
    if handle: handle.close()
    if temp:
        try: os.unlink(temp)
        except FileNotFoundError: pass
