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
  const REGISTRAR_ROLE = await reg.REGISTRAR_ROLE();

  let passed = 0;
  const t = async (name, fn) => { await fn(); passed++; console.log("  ✓", name); };

  await t("admin is a registrar by default", async () => {
    assert.equal(await reg.isRegistrar(await admin.getAddress()), true);
  });

  await t("strangers cannot register panels", async () => {
    await expectRevert(reg.connect(stranger).registerPanel.staticCall("SG-1", h("alice")), "AccessControlUnauthorizedAccount");
  });

  await t("admin can add an installer as registrar", async () => {
    await (await reg.grantRole(REGISTRAR_ROLE, await installer.getAddress())).wait();
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
    await expectRevert(
      reg.connect(installer).grantRole.staticCall(REGISTRAR_ROLE, await stranger.getAddress()),
      "AccessControlUnauthorizedAccount"
    );
  });

  await t("only the admin can pause", async () => {
    await expectRevert(reg.connect(installer).pause.staticCall(), "AccessControlUnauthorizedAccount");
    await expectRevert(reg.connect(stranger).pause.staticCall(), "AccessControlUnauthorizedAccount");
    await (await reg.pause()).wait();
    assert.equal(await reg.paused(), true);
  });

  await t("paused contract rejects writes but getPanel still reads", async () => {
    await expectRevert(reg.connect(installer).registerPanel.staticCall("SG-2", h("carol")), "EnforcedPause");
    await expectRevert(reg.reportStolen.staticCall("SG-1", "x"), "EnforcedPause");
    await expectRevert(reg.connect(installer).unpause.staticCall(), "AccessControlUnauthorizedAccount");
    assert.equal((await reg.getPanel("SG-1")).status, 1n);
  });

  await t("unpause restores writes", async () => {
    await (await reg.unpause()).wait();
    await (await reg.connect(installer).registerPanel("SG-2", h("carol"))).wait();
    assert.equal((await reg.getPanel("SG-2")).status, 1n);
  });

  await t("revoked registrar loses write access", async () => {
    await (await reg.revokeRole(REGISTRAR_ROLE, await installer.getAddress())).wait();
    assert.equal(await reg.isRegistrar(await installer.getAddress()), false);
    await expectRevert(
      reg.connect(installer).registerPanel.staticCall("SG-3", h("dave")),
      "AccessControlUnauthorizedAccount"
    );
  });

  console.log(`\n${passed} passing`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
