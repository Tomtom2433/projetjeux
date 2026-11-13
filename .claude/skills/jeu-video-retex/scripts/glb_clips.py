# Turn animated GLBs into one shared clip file (rotations as deltas from the rest pose, so they
# retarget onto any character rigged on the same skeleton), and slim a rigged GLB for the game.
import json, struct, sys, io, math
from PIL import Image

def load(path):
    d = open(path, 'rb').read()
    l = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + l])
    boff = 20 + l
    blen = struct.unpack_from('<I', d, boff)[0]
    return j, d[boff + 8: boff + 8 + blen]

def acc(j, b, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 4 * n)
    return [struct.unpack_from('<%df' % n, b, off + k * stride) for k in range(a['count'])]

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
def qinv(q): return (-q[0], -q[1], -q[2], q[3])

def clip(path, fps=15, noyaw=False):
    j, b = load(path)
    nodes = j['nodes']
    a = j['animations'][0]
    dur = max(j['accessors'][s['input']]['max'][0] for s in a['samplers'])
    n = max(2, int(round(dur * fps)) + 1)
    out = {'dur': round(dur, 3), 'n': n, 'rot': {}, 'hips': None}
    for c in a['channels']:
        node = nodes[c['target']['node']]; name = node.get('name'); path_ = c['target']['path']
        s = a['samplers'][c['sampler']]
        times = [t[0] for t in acc(j, b, s['input'])]; vals = acc(j, b, s['output'])
        def sample(t):
            k = 0
            while k < len(times) - 2 and times[k + 1] < t: k += 1
            t0, t1 = times[k], times[min(k + 1, len(times) - 1)]
            u = 0 if t1 <= t0 else min(1, max(0, (t - t0) / (t1 - t0)))
            v0, v1 = vals[k], vals[min(k + 1, len(vals) - 1)]
            if path_ == 'rotation' and sum(x*y for x, y in zip(v0, v1)) < 0: v1 = tuple(-x for x in v1)
            v = [x + (y - x) * u for x, y in zip(v0, v1)]
            if path_ == 'rotation':
                m = math.sqrt(sum(x*x for x in v)) or 1; v = [x / m for x in v]
            return v
        if path_ == 'rotation':
            rest = tuple(node.get('rotation', [0, 0, 0, 1]))
            arr = []
            for f in range(n):
                q = qmul(qinv(rest), tuple(sample(dur * f / (n - 1))))
                arr += [round(x, 4) for x in q]
            if name == 'Hips' and noyaw:
                # a standing clip must face where the game says: drop the turn about the vertical, keep the tilt
                fixed = []
                for f in range(n):
                    x, y, z, w = arr[f * 4: f * 4 + 4]
                    m = math.sqrt(y * y + w * w) or 1
                    tw = (0, y / m, 0, w / m)
                    sw = qmul((x, y, z, w), qinv(tw))
                    fixed += [round(v, 4) for v in sw]
                arr = fixed
            out['rot'][name] = arr
        elif path_ == 'translation' and name == 'Hips':
            rest = node.get('translation', [0, 0, 0]); h = rest[1] or 1
            arr = []
            for f in range(n):
                p = sample(dur * f / (n - 1))
                arr += [round((p[k] - rest[k]) / h, 4) for k in range(3)]
            out['hips'] = arr
    return out

def cycles(c, bone='LeftUpLeg'):
    # count full swings of a thigh to learn how many strides the clip holds
    r = c['rot'].get(bone); n = c['n']
    xs = [r[i * 4] for i in range(n)]
    mean = sum(xs) / n; ups = 0
    for i in range(1, n):
        if xs[i - 1] < mean <= xs[i]: ups += 1
    return ups

def slim(src, dst, size=768):
    j, b = load(src)
    j.pop('animations', None)
    views = j['bufferViews']
    imgs = {im['bufferView']: i for i, im in enumerate(j.get('images', []))}
    out = bytearray()
    for i, v in enumerate(views):
        chunk = b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        if i in imgs:
            im = Image.open(io.BytesIO(chunk)).convert('RGB').resize((size, size), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=82, optimize=True); chunk = buf.getvalue()
            j['images'][imgs[i]]['mimeType'] = 'image/jpeg'
        while len(out) % 4: out.append(0)
        v['byteOffset'] = len(out); v['byteLength'] = len(chunk); out += chunk
    while len(out) % 4: out.append(0)
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    open(dst, 'wb').write(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out))
    return total

if __name__ == '__main__':
    if len(sys.argv) < 4 or sys.argv[1] not in ('clips', 'slim'):
        sys.exit('usage: glb_clips.py clips <sortie.json> <nom> [<nom> ...]   (lit <nom>.glb dans le dossier courant)\n       glb_clips.py slim <entree.glb> <sortie.glb>')
    mode = sys.argv[1]
    if mode == 'clips':
        res = {}
        for name in sys.argv[3:]:
            stand = name in ('idle', 'talk', 'search', 'punch', 'look', 'crouch')
            c = clip(name + '.glb', noyaw=stand); c['cycles'] = 0 if stand else cycles(c); res[name] = c
            print(name, c['dur'], 's', c['n'], 'frames', 'cycles', c['cycles'], 'bones', len(c['rot']))
        open(sys.argv[2], 'w').write(json.dumps(res, separators=(',', ':')))
    else:
        print(sys.argv[3], slim(sys.argv[2], sys.argv[3]) // 1000, 'KB')
