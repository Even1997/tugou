const test = require("node:test"),
  assert = require("node:assert/strict"),
  sharp = require("sharp");
const { prepare, finish, decode, encode } = require("../core/cloud-pixels.cjs");
const { cloudSettings } = require("../core/cloud-settings.cjs");
function fixture(w = 6, h = 4) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 7) % 256;
    data[i * 4 + 1] = 99;
    data[i * 4 + 2] = 211;
    data[i * 4 + 3] = [0, 31, 128, 255][i % 4];
  }
  return { data, width: w, height: h };
}
const flat = (w, h, rgba) => ({
  data: Buffer.from(Array.from({ length: w * h }, () => rgba).flat()),
  width: w,
  height: h,
});
test("arbitrary masks use alpha or luminance, inverted masks and soft premultiplied blending protect exact RGBA", async () => {
  const src = fixture(4, 1),
    bytes = await encode(src);
  const mask = {
    width: 4,
    height: 1,
    data: Buffer.from([
      255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 128, 255, 255, 255, 255,
    ]),
  };
  const maskBytes = await encode(mask),
    generated = await encode(flat(4, 1, [200, 0, 10, 255]));
  for (const [channel, values] of [
    ["alpha", [0, 255, 128, 255]],
    ["luminance", [0, 0, 128, 255]],
  ]) {
    for (const invert of [false, true]) {
      const s = {
        operation: "cloudEdit",
        instruction: "test",
        maskMode: "asset",
        maskId: "m",
        maskChannel: channel,
        invertMask: invert,
      };
      const p = await prepare(bytes, s, maskBytes),
        request = await decode(p.mask);
      const output = await decode(
        await finish(bytes, generated, s, false, maskBytes),
      );
      for (let j = 0; j < 4; j++) {
        const v = invert ? 255 - values[j] : values[j],
          i = j * 4;
        assert.equal(request.data[i + 3], 255 - v);
        if (v === 0)
          assert.deepEqual(
            output.data.subarray(i, i + 4),
            src.data.subarray(i, i + 4),
          );
        else if (v === 255)
          assert.deepEqual(
            [...output.data.subarray(i, i + 4)],
            [200, 0, 10, 255],
          );
        else {
          const c = v / 255,
            a = src.data[i + 3] * (1 - c) + 255 * c;
          assert.deepEqual(
            [...output.data.subarray(i, i + 4)],
            [0, 1, 2]
              .map((k) =>
                Math.round(
                  (src.data[i + k] * src.data[i + 3] * (1 - c) +
                    [200, 0, 10][k] * 255 * c) /
                    a,
                ),
              )
              .concat(Math.round(a)),
          );
        }
      }
    }
  }
});
test("empty, missing, mismatched and invalid arbitrary masks fail before generation", async () => {
  const bytes = await encode(fixture()),
    s = {
      operation: "cloudEdit",
      instruction: "test",
      maskMode: "asset",
      maskId: "m",
    };
  await assert.rejects(prepare(bytes, s), /蒙版资源缺失/);
  await assert.rejects(
    prepare(bytes, s, await encode(flat(6, 4, [1, 2, 3, 0]))),
    /没有可修改区域/,
  );
  await assert.rejects(
    prepare(bytes, s, await encode(flat(7, 4, [1, 2, 3, 255]))),
    /尺寸一致/,
  );
  assert.throws(
    () =>
      cloudSettings({ ...s, maskChannel: "other" }, { width: 6, height: 4 }),
    /蒙版参数无效/,
  );
});
test("cloud edit mask and finish preserve every protected RGBA byte including hidden transparent color", async () => {
  const src = fixture(),
    bytes = await encode(src),
    s = {
      operation: "cloudEdit",
      instruction: "改花色",
      left: 2,
      top: 1,
      width: 2,
      height: 2,
      feather: 0,
    };
  const p = await prepare(bytes, s),
    mask = await decode(p.mask);
  assert.deepEqual((await decode(p.bytes || p.image)).data, src.data);
  const generated = flat(6, 4, [230, 12, 7, 153]),
    output = await decode(
      await finish(p.canonical, await encode(generated), s),
    );
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 6; x++) {
      const i = (y * 6 + x) * 4,
        inside = x >= 2 && x < 4 && y >= 1 && y < 3;
      assert.equal(mask.data[i + 3], inside ? 0 : 255);
      assert.deepEqual(
        output.data.subarray(i, i + 4),
        (inside ? generated : src).data.subarray(i, i + 4),
      );
    }
});
test("cloud extension retains transparent source pixels at exact offset and only allows new-area edits", async () => {
  const src = fixture(),
    s = {
      operation: "cloudExtend",
      width: 10,
      height: 8,
      left: 3,
      top: 2,
      instruction: "",
    },
    p = await prepare(await encode(src), s),
    mask = await decode(p.mask),
    frame = await decode(p.image);
  const output = await decode(
    await finish(p.canonical, await encode(flat(10, 8, [200, 20, 8, 255])), s),
  );
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 10; x++) {
      const i = (y * 10 + x) * 4,
        inside = x >= 3 && x < 9 && y >= 2 && y < 6;
      assert.equal(mask.data[i + 3], inside ? 255 : 0);
      if (inside) {
        const j = ((y - 2) * 6 + x - 3) * 4;
        assert.deepEqual(
          frame.data.subarray(i, i + 4),
          src.data.subarray(j, j + 4),
        );
        assert.deepEqual(
          output.data.subarray(i, i + 4),
          src.data.subarray(j, j + 4),
        );
      } else {
        const sx=Math.max(0,Math.min(5,x-3)),sy=Math.max(0,Math.min(3,y-2)),j=(sy*6+sx)*4;
        assert.equal(frame.data[i+3],255);
        for(let k=0;k<3;k++) assert.ok(Math.abs(frame.data[i+k]-(src.data[j+k]*src.data[j+3]/255+255-src.data[j+3]))<=1);
        assert.deepEqual(
          [...output.data.subarray(i, i + 4)],
          [200, 20, 8, 255],
        );
      }
    }
});
test("cloud enhancement retains original alpha and upscale retains uniform alpha analytically", async () => {
  const src = fixture(),
    result = await decode(
      await finish(
        await encode(src),
        await encode(flat(6, 4, [5, 44, 178, 255])),
        { operation: "cloudEnhance" },
      ),
    );
  for (let i = 0; i < 24; i++) {
    assert.deepEqual([...result.data.subarray(i * 4, i * 4 + 3)], [5, 44, 178]);
    assert.equal(result.data[i * 4 + 3], src.data[i * 4 + 3]);
  }
  const scaled = await decode(
    await finish(
      await encode(flat(6, 4, [1, 2, 3, 77])),
      await encode(flat(12, 8, [6, 7, 8, 255])),
      { operation: "cloudUpscale", scale: 2 },
    ),
  );
  for (let i = 0; i < 96; i++) assert.equal(scaled.data[i * 4 + 3], 77);
});
test("feather stays inside selected rectangle and uses premultiplied blend for partial alpha", async () => {
  const src = flat(5, 5, [100, 0, 0, 128]),
    s = {
      operation: "cloudEdit",
      left: 1,
      top: 1,
      width: 3,
      height: 3,
      feather: 1,
      instruction: "change",
    };
  const result = await decode(
    await finish(
      await encode(src),
      await encode(flat(5, 5, [0, 0, 100, 255])),
      s,
    ),
  );
  assert.deepEqual([...result.data.subarray(0, 4)], [100, 0, 0, 128]);
  assert.deepEqual([...result.data.subarray(24, 28)], [33, 0, 67, 192]);
  assert.deepEqual([...result.data.subarray(48, 52)], [0, 0, 100, 255]);
});
test("fit requires explicit choice, larger same-aspect output, never fabricates missing resolution", async () => {
  const src = await encode(fixture()),
    s = { operation: "cloudEnhance" },
    large = await encode(flat(12, 8, [200, 50, 3, 255]));
  await assert.rejects(finish(src, large, s), /原始图已保留/);
  assert.equal((await decode(await finish(src, large, s, true))).width, 6);
  for (const [w, h] of [
    [3, 2],
    [12, 9],
  ])
    await assert.rejects(
      finish(src, await encode(flat(w, h, [1, 2, 3, 255])), s, true),
      /原始图已保留/,
    );
});
test('EXIF-oriented returned images are aligned by displayed dimensions before compositing', async () => {
  const source = await encode(fixture(4, 6));
  const generated = await sharp(await encode(flat(6, 4, [200, 30, 80, 255])))
    .jpeg().withMetadata({orientation:6}).toBuffer();
  const settings = {operation:'cloudEdit',instruction:'test',left:1,top:2,width:2,height:2};
  const result = await decode(await finish(source, generated, settings));
  const original = await decode(source);
  assert.deepEqual([result.width,result.height],[4,6]);
  for(let y=0;y<6;y++) for(let x=0;x<4;x++) {
    const i=(y*4+x)*4;
    if(x<1||x>=3||y<2||y>=4) assert.deepEqual(result.data.subarray(i,i+4),original.data.subarray(i,i+4));
  }
});
test("EXIF rotation is normalized before masking and unsupported sizes are rejected", async () => {
  const jpeg = await sharp(await encode(fixture(6, 4)))
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const p = await prepare(jpeg, { operation: "cloudEnhance" });
  assert.deepEqual(p.sourceSize, { width: 4, height: 6 });
  assert.deepEqual(p.size, { width: 4, height: 6 });
  assert.throws(
    () =>
      cloudSettings(
        {
          operation: "cloudEdit",
          instruction: "",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
        },
        fixture(),
      ),
    /填写/,
  );
  assert.throws(
    () =>
      cloudSettings(
        { operation: "cloudUpscale", scale: 4 },
        { width: 3000, height: 3000 },
      ),
    /像素/,
  );
});
