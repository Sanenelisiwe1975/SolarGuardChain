// End-to-end contract tests on an in-memory chain (ganache). Run: npm test
const assert = require("assert");
const ganache = require("ganache");
const { ethers } = require("ethers");
const artifact = require("./build/SolarRegistry.json");

const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function expectRevert(promise, name) {
  try {
    await promise;
  } catch (e) {
    const msg = (e.shortMessage || "") + (e.message || "") + JSON.stringify(e.revert || {});
    const iface = new ethers.Interface(artifact.abi);
    const data = e.data || e.info?.error?.data?.data || e.info?.error?.data;
    let decoded = null;
    try { decoded = iface.parseError(data)?.name; } catch {}
    assert.ok(decoded === name || msg.includes(name), `expected ${name}, got ${decoded || msg.slice(0, 200)}`);
    return;
  }
  assert.fail(`expected revert ${name}`);
}

(async () => {
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true }, chain: { hardfork: "merge" } })
  );
  const admin = await provider.getSigner(0);
  const installer = await provider.getSigner(1);
  const stranger = await provider.getSigner(2);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, admin);
  const reg = await factory.deploy();
  await reg.waitForDeployment();

  let passed = 0;
  const t = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };

  await t("admin is a registrar by default", async () => {
    assert.equal(await reg.isRegistrar(await admin.getAddress()), true);
  });

  await t("strangers cannot register panels", async () => {
    await expectRevert(reg.connect(stranger).registerPanel.staticCall("SG-1", h("alice")), "NotRegistrar");
  });

  await t("admin can add an installer as registrar", async () => {
    await (await reg.setRegistrar(await installer.getAddress(), true)).wait();
    assert.equal(await reg.isRegistrar(await installer.getAddress()), true);
  });

  await t("installer registers a panel; status Clean", async () => {
    await (await reg.connect(installer).registerPanel("SG-1", h("alice"))).wait();
    const p = await reg.getPanel("SG-1");
    assert.equal(p.status, 1n);
    assert.equal(p.ownerHash, h("alice"));
    assert.equal(await reg.panelCount(), 1n);
  });

  await t("duplicate registration is rejected", async () => {
    await expectRevert(reg.registerPanel.staticCall("SG-1", h("bob")), "AlreadyRegistered");
  });

  await t("empty serial and empty owner are rejected", async () => {
    await expectRevert(reg.registerPanel.staticCall("", h("x")), "EmptySerial");
    await expectRevert(reg.registerPanel.staticCall("SG-9", ethers.ZeroHash), "EmptyOwner");
  });

  await t("ownership transfer updates owner and count", async () => {
    await (await reg.transferOwnership("SG-1", h("bob"))).wait();
    const p = await reg.getPanel("SG-1");
    assert.equal(p.ownerHash, h("bob"));
    assert.equal(p.transfers, 1n);
  });

  await t("report stolen sets Stolen and blocks transfer", async () => {
    await (await reg.reportStolen("SG-1", "CAS 123/11/2026")).wait();
    assert.equal((await reg.getPanel("SG-1")).status, 2n);
    await expectRevert(reg.transferOwnership.staticCall("SG-1", h("thief")), "PanelIsStolen");
    await expectRevert(reg.reportStolen.staticCall("SG-1", "again"), "PanelIsStolen");
  });

  await t("recovery returns the panel to Clean", async () => {
    await (await reg.markRecovered("SG-1")).wait();
    assert.equal((await reg.getPanel("SG-1")).status, 1n);
    await expectRevert(reg.markRecovered.staticCall("SG-1"), "PanelNotStolen");
  });

  await t("unregistered serials read as Unregistered", async () => {
    assert.equal((await reg.getPanel("NOPE")).status, 0n);
    await expectRevert(reg.reportStolen.staticCall("NOPE", "x"), "NotRegistered");
  });

  await t("only admin can manage registrars", async () => {
    await expectRevert(reg.connect(installer).setRegistrar.staticCall(await stranger.getAddress(), true), "NotAdmin");
  });

  console.log(`\n${passed} passing`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
