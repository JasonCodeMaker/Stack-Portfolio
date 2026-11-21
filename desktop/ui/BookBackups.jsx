import React, { useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, Field, Modal } from "./common";

export function BookBackups({ run, restored, welcome = false }) {
  const [prompt, setPrompt] = useState(null);

  async function restore(selection, password) {
    const mode = await api.restore({ token: selection.token, password });
    if (mode) await restored(mode);
  }
  function chooseBackup() {
    run(async () => {
      const selection = await api.selectBackup();
      if (!selection) return;
      if (selection.needsPassword) setPrompt({ action: "restore", selection });
      else await restore(selection);
    }, false);
  }
  function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = form.elements.password.value;
    if (form.elements.confirm && form.elements.confirm.value !== password) {
      form.elements.confirm.setCustomValidity("两次输入的密码不同。");
      form.reportValidity();
      return;
    }
    form.reset();
    setPrompt(null);
    run(async () => {
      if (prompt.action === "restore") return restore(prompt.selection, password);
      const name = await api.backup({ password, convertLegacy: prompt.action === "convert" });
      if (name) return "已保存 " + name;
    }, false);
  }
  const reading = prompt?.action === "restore";
  return <>
    {!welcome && <button onClick={() => setPrompt({ action: "save" })}><Download size={15} />备份账本</button>}
    <button className={welcome ? "text-btn" : undefined} onClick={chooseBackup}>
      {!welcome && <Upload size={15} />}{welcome ? "从账本备份恢复" : "恢复账本备份"}
    </button>
    {!welcome && <button onClick={() => setPrompt({ action: "convert" })}>加密旧备份</button>}
    {prompt && <Modal title={reading ? "解锁备份" : "设置备份密码"} close={() => setPrompt(null)}>
      <form onSubmit={submit} onInput={(e) => e.currentTarget.elements.confirm?.setCustomValidity("")}>
        <p>{reading ? prompt.selection.name : "请将密码保存在密码管理器中。换电脑或重装 Windows 后，可用它恢复这份备份。"}</p>
        {prompt.action === "convert" && <p>请选择旧版或本机备份，再选择密码加密副本的位置。若原文件含明文，请在验证副本后妥善处理原件。</p>}
        <Field label={reading ? "备份密码" : "备份密码（至少 12 个字符）"}>
          <input name="password" type="password" minLength={12} maxLength={1024} required autoFocus
            autoComplete={reading ? "current-password" : "new-password"} />
        </Field>
        {!reading && <Field label="再次输入密码">
          <input name="confirm" type="password" required maxLength={1024} autoComplete="new-password" />
        </Field>}
        <div className="actions">
          <button type="button" onClick={() => setPrompt(null)}>取消</button>
          <button className="primary">{reading ? "解锁并恢复" : "选择文件位置"}</button>
        </div>
      </form>
    </Modal>}
  </>;
}
