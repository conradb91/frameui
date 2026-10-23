import pathlib,tempfile,subprocess,struct,json,sys,shutil
root=pathlib.Path(tempfile.mkdtemp(prefix='frameui-bridge-test-'));source=pathlib.Path('integrations/chrome-extension/native-host.py').read_text().replace("ROOT=pathlib.Path.home()/'Library/Application Support/FrameUI Chrome Bridge'",'ROOT=pathlib.Path('+repr(str(root))+')').replace("subprocess.run(['/usr/bin/open','-a',app],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)","assert app==str(ROOT/'FrameUI.app')")
(root/'native-host.py').write_text(source);(root/'FrameUI.app').mkdir();(root/'config.json').write_text(json.dumps({'app':str(root/'FrameUI.app')}));data=json.loads(pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'review-exports/chrome-verification/capture.frameui-capture.json').read_text());data['unicode']='🛳️';body=json.dumps(data,ensure_ascii=False);commands=[{'command':'begin'}]+[{'command':'chunk','text':body[i:i+60000]} for i in range(0,len(body),60000)]+[{'command':'finish'}];wire=b''
for command in commands:
 b=json.dumps(command).encode();wire+=struct.pack('<I',len(b))+b
result=subprocess.run(['/usr/bin/python3',str(root/'native-host.py')],input=wire,capture_output=True,check=True);out=result.stdout;messages=[]
while out:
 n=struct.unpack('<I',out[:4])[0];messages.append(json.loads(out[4:4+n]));out=out[4+n:]
assert all(m.get('ok') for m in messages),messages
files=list((root/'inbox').glob('*.json'));assert len(files)==1;assert json.loads(files[0].read_text())==data;assert not list((root/'inbox').glob('*.part'));assert files[0].stat().st_mode&0o777==0o600
print('Native bridge: chunked transfer, Unicode round trip, private file permissions and atomic completion verified')

shutil.rmtree(root)
