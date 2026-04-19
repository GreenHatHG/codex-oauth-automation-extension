// content/qq-mail.js — Content script for QQ Mail (steps 4, 7)
// Injected on: mail.qq.com, wx.mail.qq.com
// NOTE: all_frames: true
//
// Strategy for avoiding stale codes:
// 1. On poll start, snapshot all existing mail IDs as "old"
// 2. On each poll cycle, refresh inbox and look for NEW items (not in snapshot)
// 3. Only extract codes from NEW items that match sender/subject filters

const QQ_MAIL_PREFIX = '[MultiPage:qq-mail]';
const isTopFrame = window === window.top;
const QQ_ALIAS_FLOW_STAGE_START = 'start';
const QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN = 'after_token';
const QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER = 'after_slider';
const QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS = 'open_new_alias';
const QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR = '.verifyUplink_bottom .qm_popover .verify_bottom_pop';
const QQ_ALIAS_VERIFY_MORE_TEXT_SELECTOR = '.verifyUplink_bottom .qm_popover .verify_bottom_pop .verify_bottom_pop_text';
const QQ_ALIAS_VERIFY_MORE_ICON_SELECTOR = '.verifyUplink_bottom .qm_popover .verify_bottom_pop img';
const QQ_ALIAS_VERIFY_MORE_WRAPPER_SELECTOR = '.verifyUplink_bottom .qm_popover';
const QQ_ALIAS_VERIFY_MORE_ACTIVE_CLASS = 'verify_bottom_pop_active';
const QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR = '.qm_popover_container.opt_popup';
const QQ_ALIAS_VERIFY_PASSWORD_OPTION_SELECTOR = '.qm_popover_container.opt_popup p';
const QQ_ALIAS_DELETE_TRIGGER_SELECTOR = '#container > div > div.wrapper > div.home > div.home_mainWrapper > div > div.home_content > div > div.account > div:nth-child(4) > div.account_item_control > span';
const QQ_ALIAS_DELETE_CONFIRM_CHECKBOX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_before > div.delAlias_before_checkbox > div';
const QQ_ALIAS_DELETE_CONFIRM_BUTTON_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_before > div.delAlias_before_control > button';
const QQ_ALIAS_VERIFY_PASSWORD_TEXT_PATTERN = /使用\s*QQ\s*(?:密保验证|密码验证)|QQ\s*密保|QQ\s*密码验证/i;
const QQ_ALIAS_USE_TOKEN_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verifyUplink_inner > div.verifyUplink_top > div:nth-child(2) > div.verifyUplink_qrFail > div.verifyUplink_qrFail_toggle';
const QQ_ALIAS_USE_TOKEN_TEXT_PATTERN = /QQ\s*令牌/i;
const QQ_ALIAS_SUBMIT_AUTH_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_code_bottom > button';
const QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_confirm > div.delAlias_confirm_control > button';
const QQ_ALIAS_OPEN_TRIGGER_SELECTOR = '#container > div > div.wrapper > div.home > div.home_mainWrapper > div > div.home_content > div > div.account > div:nth-child(4) > div > span.account_item_mail > button';
const QQ_ALIAS_INPUT_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_mail > div.open_mail_inner > div > input';
const QQ_ALIAS_AGREE_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_protocol > div.xmail-ui-checkbox > div';
const QQ_ALIAS_OPEN_CONFIRM_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_confirm > div > div';
const QQ_ALIAS_COPY_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.succ > div > div > span.succ_acct_copy';
const QQ_ALIAS_OPEN_TRIGGER_TEXT_PATTERN = /重新申请|重新开通|申请.*(?:英文邮箱|别名)|开通.*(?:英文邮箱|别名)|创建.*(?:英文邮箱|别名)|英文邮箱/i;
const QQ_ALIAS_SLIDER_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[id*="tcaptcha"]',
  'iframe[name*="tcaptcha"]',
  '#tcaptcha_iframe',
  '#tcaptcha_iframe_dy',
  '[id*="tcaptcha"]',
  '[class*="tcaptcha"]',
];
const QQ_ALIAS_MANUAL_TOKEN_WAIT_MS = 300000;
const QQ_ALIAS_MANUAL_SLIDER_WAIT_MS = 300000;

console.log(QQ_MAIL_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    if (!isTopFrame) {
      sendResponse({ ok: false, reason: 'wrong-frame' });
      return;
    }
    resetStopState();
    handlePollEmail(message.step, message.payload).then(result => {
      sendResponse(result);
    }).catch(err => {
      if (isStopError(err)) {
        log(`步骤 ${message.step}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`步骤 ${message.step}：邮箱轮询失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true; // async response
  }

  if (message.type === 'QQ_ALIAS_FLOW') {
    if (!isTopFrame) {
      sendResponse({ ok: false, reason: 'wrong-frame' });
      return;
    }
    resetStopState();
    handleQqAliasFlow(message.payload || {}).then(result => {
      sendResponse(result);
    }).catch(err => {
      if (isStopError(err)) {
        log('QQ 别名流程：已被用户停止。', 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`QQ 别名流程失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true;
  }
});

function isVisibleElement(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0;
}

function getVisibleElement(selector) {
  const candidates = document.querySelectorAll(selector);
  for (const candidate of candidates) {
    if (isVisibleElement(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function waitForVisibleSelector(selector, timeout = 15000) {
  const endAt = Date.now() + timeout;
  while (Date.now() < endAt) {
    throwIfStopped();
    const element = getVisibleElement(selector);
    if (element) {
      return element;
    }
    await sleep(200);
  }
  throw new Error(`等待 QQ 别名元素超时：${selector}`);
}

async function waitForAnyVisibleSelector(selectors, timeout = 15000) {
  const endAt = Date.now() + timeout;
  const normalizedSelectors = Array.isArray(selectors) ? selectors.filter(Boolean) : [];
  while (Date.now() < endAt) {
    throwIfStopped();
    for (const selector of normalizedSelectors) {
      const element = getVisibleElement(selector);
      if (element) {
        return { selector, element };
      }
    }
    await sleep(200);
  }
  throw new Error(`等待 QQ 别名页面状态超时：${normalizedSelectors.join(' / ')}`);
}

async function clickVisibleSelector(selector, label, timeout = 15000) {
  const element = await waitForVisibleSelector(selector, timeout);
  await humanPause(250, 700);
  simulateClick(element);
  if (label) {
    log(`QQ 别名：已点击${label}`);
  }
  await sleep(500);
  return element;
}

function getQqAliasVerifyMoreTargets() {
  const targets = [
    getVisibleElement(QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR),
    getVisibleElement(QQ_ALIAS_VERIFY_MORE_TEXT_SELECTOR),
    getVisibleElement(QQ_ALIAS_VERIFY_MORE_ICON_SELECTOR),
    getVisibleElement(QQ_ALIAS_VERIFY_MORE_WRAPPER_SELECTOR),
  ].filter(Boolean);

  return [...new Set(targets)];
}

function dispatchQqAliasMouseSequence(element) {
  if (!element) {
    return;
  }

  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const mouseOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
  };

  if (typeof element.focus === 'function') {
    element.focus({ preventScroll: true });
  }

  element.dispatchEvent(new MouseEvent('mouseover', mouseOptions));
  element.dispatchEvent(new MouseEvent('mouseenter', mouseOptions));
  element.dispatchEvent(new MouseEvent('mousemove', mouseOptions));

  if (typeof window.PointerEvent === 'function') {
    element.dispatchEvent(new PointerEvent('pointerdown', {
      ...mouseOptions,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
  }

  element.dispatchEvent(new MouseEvent('mousedown', {
    ...mouseOptions,
    button: 0,
    buttons: 1,
  }));

  element.dispatchEvent(new MouseEvent('mouseup', {
    ...mouseOptions,
    button: 0,
    buttons: 0,
  }));

  if (typeof window.PointerEvent === 'function') {
    element.dispatchEvent(new PointerEvent('pointerup', {
      ...mouseOptions,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  }

  element.dispatchEvent(new MouseEvent('click', {
    ...mouseOptions,
    button: 0,
    buttons: 0,
  }));
}

function findVisibleElementByText(selector, pattern) {
  const normalizedPattern = pattern instanceof RegExp ? pattern : new RegExp(String(pattern || ''), 'i');
  const candidates = document.querySelectorAll(selector);
  for (const candidate of candidates) {
    if (!isVisibleElement(candidate)) {
      continue;
    }
    const text = String(candidate.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && normalizedPattern.test(text)) {
      return candidate;
    }
  }
  return null;
}

function resolveClickableTextTarget(element) {
  if (!element) {
    return null;
  }

  const clickable = element.closest('button, [role="button"], li, a, div');
  if (clickable && isVisibleElement(clickable)) {
    return clickable;
  }
  return element;
}

async function clickVisibleElementByText(selector, pattern, label, timeout = 15000) {
  const endAt = Date.now() + timeout;
  while (Date.now() < endAt) {
    throwIfStopped();
    const element = findVisibleElementByText(selector, pattern);
    if (element) {
      const target = resolveClickableTextTarget(element);
      await humanPause(250, 700);
      simulateClick(target);
      if (label) {
        log(`QQ 别名：已点击${label}`);
      }
      await sleep(500);
      return target;
    }
    await sleep(200);
  }
  throw new Error(`等待 QQ 别名文本元素超时：${pattern}`);
}

async function waitForVisibleSelectorSafely(selector, timeout = 1500) {
  try {
    return await waitForVisibleSelector(selector, timeout);
  } catch (error) {
    if (isStopError(error)) {
      throw error;
    }
    return null;
  }
}

async function waitForAnyVisibleSelectorSafely(selectors, timeout = 15000) {
  try {
    return await waitForAnyVisibleSelector(selectors, timeout);
  } catch (error) {
    if (isStopError(error)) {
      throw error;
    }
    return null;
  }
}

function isTextMatched(element, pattern) {
  if (!element) {
    return false;
  }

  const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
  return Boolean(text && pattern.test(text));
}

function getQqAliasVerifyPasswordTargets() {
  const popup = getVisibleElement(QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR);
  if (!popup) {
    return [];
  }

  const optionText = [...popup.querySelectorAll('p')].find(
    (element) => isVisibleElement(element) && isTextMatched(element, QQ_ALIAS_VERIFY_PASSWORD_TEXT_PATTERN)
  );
  if (!optionText) {
    return [];
  }

  const optionRow = optionText.parentElement;
  const targets = [optionText];
  if (optionRow && isVisibleElement(optionRow)) {
    targets.push(optionRow);
  }

  return [...new Set(targets)];
}

function getQqAliasUseTokenToggle() {
  const toggle = getVisibleElement(QQ_ALIAS_USE_TOKEN_SELECTOR);
  if (!toggle || !isTextMatched(toggle, QQ_ALIAS_USE_TOKEN_TEXT_PATTERN)) {
    return null;
  }
  return toggle;
}

function getQqAliasOpenTrigger() {
  return getVisibleElement(QQ_ALIAS_OPEN_TRIGGER_SELECTOR)
    || findVisibleElementByText('button, [role="button"], a, span, div', QQ_ALIAS_OPEN_TRIGGER_TEXT_PATTERN);
}

function getQqAliasReadyForOpenNewAliasState() {
  if (getVisibleElement(QQ_ALIAS_COPY_SELECTOR)) {
    return { kind: 'success' };
  }

  if (getVisibleElement(QQ_ALIAS_INPUT_SELECTOR)) {
    return { kind: 'input' };
  }

  if (getQqAliasOpenTrigger()) {
    return { kind: 'open_trigger' };
  }

  return null;
}

function isQqAliasSliderVisible() {
  for (const selector of QQ_ALIAS_SLIDER_SELECTORS) {
    if (getVisibleElement(selector)) {
      return true;
    }
  }
  return false;
}

async function clickQqAliasOpenTrigger(timeout = 20000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();
    const trigger = getQqAliasOpenTrigger();
    if (trigger) {
      await humanPause(250, 700);
      simulateClick(resolveClickableTextTarget(trigger));
      log('QQ 别名：已点击重新申请别名');
      await sleep(500);
      return trigger;
    }
    await sleep(200);
  }

  throw new Error('没有找到可用的“重新申请别名”入口。');
}

async function waitForQqAliasUseTokenToggle(timeout = 1500) {
  const endAt = Date.now() + timeout;
  while (Date.now() < endAt) {
    throwIfStopped();
    const toggle = getQqAliasUseTokenToggle();
    if (toggle) {
      return toggle;
    }
    await sleep(120);
  }
  return null;
}

async function clickQqAliasVerifyPasswordOption(timeout = 15000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();

    const targets = getQqAliasVerifyPasswordTargets();
    for (const target of targets) {
      await humanPause(250, 700);
      simulateClick(target);
      if (await waitForQqAliasUseTokenToggle(1500)) {
        log('QQ 别名：已点击QQ 密码验证');
        return target;
      }

      dispatchQqAliasMouseSequence(target);
      if (await waitForQqAliasUseTokenToggle(1800)) {
        log('QQ 别名：已点击QQ 密码验证');
        return target;
      }
    }

    if (!getVisibleElement(QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR)) {
      await clickQqAliasVerifyMore(Math.max(1500, endAt - Date.now()));
    }

    await sleep(150);
  }

  throw new Error('已尝试点击“使用 QQ 密保验证”，但没有进入 QQ 密保验证页面。');
}

async function clickQqAliasUseTokenToggle(timeout = 15000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();
    const toggle = getQqAliasUseTokenToggle();
    if (toggle) {
      await humanPause(250, 700);
      simulateClick(toggle);
      if (await waitForVisibleSelectorSafely(QQ_ALIAS_SUBMIT_AUTH_SELECTOR, 2000)) {
        log('QQ 别名：已点击使用 QQ 令牌');
        return toggle;
      }
    }
    await sleep(150);
  }

  throw new Error('已进入 QQ 密保验证页面，但没有找到“使用 QQ 令牌”入口。');
}

async function waitForQqAliasPostTokenState(timeout = QQ_ALIAS_MANUAL_TOKEN_WAIT_MS) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();

    const readyState = getQqAliasReadyForOpenNewAliasState();
    if (readyState) {
      return readyState;
    }

    if (getVisibleElement(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR)) {
      return { kind: 'final_delete' };
    }

    await sleep(250);
  }

  return null;
}

async function waitForQqAliasDeletionComplete(timeout = QQ_ALIAS_MANUAL_SLIDER_WAIT_MS) {
  const endAt = Date.now() + timeout;
  const unknownReadyFallbackMs = 12000;
  let sawSlider = false;
  let firstUnknownStateAt = 0;

  while (Date.now() < endAt) {
    throwIfStopped();

    const readyState = getQqAliasReadyForOpenNewAliasState();
    if (readyState) {
      return readyState;
    }

    if (isQqAliasSliderVisible()) {
      sawSlider = true;
      firstUnknownStateAt = 0;
      await sleep(250);
      continue;
    }

    if (!firstUnknownStateAt) {
      firstUnknownStateAt = Date.now();
    }

    if (Date.now() - firstUnknownStateAt >= unknownReadyFallbackMs) {
      return { kind: sawSlider ? 'post_slider_unknown_ready' : 'unknown_ready' };
    }

    await sleep(250);
  }

  if (sawSlider) {
    return { kind: 'slider_timeout' };
  }

  return null;
}

async function autoAdvanceQqAliasAfterManualToken() {
  await waitForVisibleSelector(QQ_ALIAS_SUBMIT_AUTH_SELECTOR, 15000);
  log('QQ 别名：请在当前页面输入 QQ 令牌并点击提交，脚本会自动继续。', 'warn');

  const postTokenState = await waitForQqAliasPostTokenState();
  if (!postTokenState) {
    return {
      pendingAction: { reason: 'token_input' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN,
    };
  }

  if (postTokenState.kind !== 'final_delete') {
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  log('QQ 别名：检测到可确认删除，必要时请完成滑块验证，脚本会自动继续。', 'warn');
  await clickVisibleSelector(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR, '确认删除', 20000);

  const deletionCompleted = await waitForQqAliasDeletionComplete();
  if (!deletionCompleted || deletionCompleted.kind === 'slider_timeout') {
    return {
      pendingAction: { reason: 'slider' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER,
    };
  }

  return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
}

function isQqAliasVerifyMoreExpanded() {
  const trigger = document.querySelector(QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR);
  return Boolean(trigger && trigger.classList.contains(QQ_ALIAS_VERIFY_MORE_ACTIVE_CLASS));
}

function isQqAliasVerifyMethodMenuVisible() {
  if (getVisibleElement(QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR)) {
    return true;
  }

  return isQqAliasVerifyMoreExpanded();
}

async function waitForQqAliasVerifyMethodMenu(timeout = 1200) {
  const endAt = Date.now() + timeout;
  while (Date.now() < endAt) {
    throwIfStopped();
    if (isQqAliasVerifyMethodMenuVisible()) {
      return true;
    }
    await sleep(120);
  }
  return false;
}

async function clickQqAliasVerifyMore(timeout = 15000) {
  const endAt = Date.now() + timeout;
  await waitForVisibleSelector(QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR, timeout);

  while (Date.now() < endAt) {
    throwIfStopped();

    if (await waitForQqAliasVerifyMethodMenu(300)) {
      log('QQ 别名：已点击更多验证方式');
      return getVisibleElement(QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR);
    }

    const targets = getQqAliasVerifyMoreTargets();
    for (const target of targets) {
      await humanPause(250, 700);
      simulateClick(target);
      if (await waitForQqAliasVerifyMethodMenu(500)) {
        log('QQ 别名：已点击更多验证方式');
        return target;
      }

      dispatchQqAliasMouseSequence(target);
      if (await waitForQqAliasVerifyMethodMenu(700)) {
        log('QQ 别名：已点击更多验证方式');
        return target;
      }
    }

    await sleep(150);
  }

  throw new Error('已点击“选择其他方式验证”，但验证方式菜单没有展开。');
}

function normalizeQqAliasLocalPart(rawValue = '') {
  const value = String(rawValue || '').trim().toLowerCase();
  return /^[a-z]+$/.test(value) ? value : '';
}

async function handleQqAliasFlow(payload = {}) {
  const stage = String(payload.stage || '').trim();
  switch (stage) {
    case QQ_ALIAS_FLOW_STAGE_START:
      return startQqAliasFlow();
    case QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN:
      return continueQqAliasAfterToken();
    case QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER:
      return continueQqAliasAfterSlider();
    case QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS:
      return openNewQqAlias(payload);
    default:
      throw new Error(`未知的 QQ 别名流程阶段：${stage || 'empty'}`);
  }
}

async function startQqAliasFlow() {
  log('QQ 别名：正在检查当前账号是否已有旧别名...');
  const accountState = await waitForAnyVisibleSelector([
    QQ_ALIAS_DELETE_TRIGGER_SELECTOR,
    QQ_ALIAS_OPEN_TRIGGER_SELECTOR,
  ], 20000);

  if (accountState.selector === QQ_ALIAS_OPEN_TRIGGER_SELECTOR) {
    log('QQ 别名：当前没有旧别名，准备直接申请新别名。', 'ok');
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  await clickVisibleSelector(QQ_ALIAS_DELETE_TRIGGER_SELECTOR, '删除旧别名');
  await clickVisibleSelector(QQ_ALIAS_DELETE_CONFIRM_CHECKBOX_SELECTOR, '删除确认复选框');
  await clickVisibleSelector(QQ_ALIAS_DELETE_CONFIRM_BUTTON_SELECTOR, '继续删除');
  await clickQqAliasVerifyMore();
  await clickQqAliasVerifyPasswordOption();
  await clickQqAliasUseTokenToggle();
  return autoAdvanceQqAliasAfterManualToken();
}

async function continueQqAliasAfterToken() {
  if (getQqAliasReadyForOpenNewAliasState()) {
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  if (getVisibleElement(QQ_ALIAS_SUBMIT_AUTH_SELECTOR)) {
    await clickVisibleSelector(QQ_ALIAS_SUBMIT_AUTH_SELECTOR, '提交认证', 20000);
  }

  const confirmDeleteButton = await waitForVisibleSelectorSafely(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR, 20000);
  if (!confirmDeleteButton) {
    return {
      pendingAction: { reason: 'token_input' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN,
    };
  }

  await clickVisibleSelector(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR, '确认删除', 20000);
  const deletionCompleted = await waitForQqAliasDeletionComplete();
  if (!deletionCompleted || deletionCompleted.kind === 'slider_timeout') {
    return {
      pendingAction: { reason: 'slider' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER,
    };
  }

  return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
}

async function continueQqAliasAfterSlider() {
  if (getQqAliasReadyForOpenNewAliasState()) {
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  if (getVisibleElement(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR)) {
    await clickVisibleSelector(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR, '确认删除', 20000);
  }

  const deletionCompleted = await waitForQqAliasDeletionComplete();
  if (!deletionCompleted || deletionCompleted.kind === 'slider_timeout') {
    return {
      pendingAction: { reason: 'slider' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER,
    };
  }

  return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
}

async function openNewQqAlias(payload = {}) {
  const localPart = normalizeQqAliasLocalPart(payload.localPart);
  if (!localPart) {
    throw new Error('QQ 别名前缀无效，必须为纯英文。');
  }

  if (getVisibleElement(QQ_ALIAS_COPY_SELECTOR)) {
    return {
      email: `${localPart}@qq.com`,
    };
  }

  if (!getVisibleElement(QQ_ALIAS_INPUT_SELECTOR)) {
    await clickQqAliasOpenTrigger(20000);
  }

  const input = await waitForVisibleSelector(QQ_ALIAS_INPUT_SELECTOR, 15000);
  fillInput(input, localPart);
  await sleep(300);
  await clickVisibleSelector(QQ_ALIAS_AGREE_SELECTOR, '同意协议');
  await clickVisibleSelector(QQ_ALIAS_OPEN_CONFIRM_SELECTOR, '继续开通');
  await waitForVisibleSelector(QQ_ALIAS_COPY_SELECTOR, 20000);
  await clickVisibleSelector(QQ_ALIAS_COPY_SELECTOR, '复制别名');
  return {
    email: `${localPart}@qq.com`,
  };
}

// ============================================================
// Get all current mail IDs from the list
// ============================================================

function getCurrentMailIds() {
  const ids = new Set();
  document.querySelectorAll('.mail-list-page-item[data-mailid]').forEach(item => {
    ids.add(item.getAttribute('data-mailid'));
  });
  return ids;
}

// ============================================================
// Email Polling
// ============================================================

async function handlePollEmail(step, payload) {
  const { senderFilters, subjectFilters, maxAttempts, intervalMs, excludeCodes = [] } = payload;
  const excludedCodeSet = new Set(excludeCodes.filter(Boolean));

  log(`步骤 ${step}：开始轮询邮箱（最多 ${maxAttempts} 次，每 ${intervalMs / 1000} 秒一次）`);

  // Wait for mail list to load
  try {
    await waitForElement('.mail-list-page-item', 10000);
    log(`步骤 ${step}：邮件列表已加载`);
  } catch {
    throw new Error('邮件列表未加载完成，请确认 QQ 邮箱已打开收件箱。');
  }

  // Step 1: Snapshot existing mail IDs BEFORE we start waiting for new email
  const existingMailIds = getCurrentMailIds();
  log(`步骤 ${step}：已将当前 ${existingMailIds.size} 封邮件标记为旧邮件快照`);

  // Fallback after just 3 attempts (~10s). In practice, the email is usually
  // already in the list but has the same mailid (page was already open).
  const FALLBACK_AFTER = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`步骤 ${step}：正在轮询 QQ 邮箱，第 ${attempt}/${maxAttempts} 次`);

    // Refresh inbox (skip on first attempt, list is fresh)
    if (attempt > 1) {
      await refreshInbox();
      await sleep(800);
    }

    const allItems = document.querySelectorAll('.mail-list-page-item[data-mailid]');
    const useFallback = attempt > FALLBACK_AFTER;

    // Phase 1 (attempt 1~3): only look at NEW emails (not in snapshot)
    // Phase 2 (attempt 4+): fallback to first matching email in list
    for (const item of allItems) {
      const mailId = item.getAttribute('data-mailid');

      if (!useFallback && existingMailIds.has(mailId)) continue;

      const sender = (item.querySelector('.cmp-account-nick')?.textContent || '').toLowerCase();
      const subject = (item.querySelector('.mail-subject')?.textContent || '').toLowerCase();
      const digest = item.querySelector('.mail-digest')?.textContent || '';

      const senderMatch = senderFilters.some(f => sender.includes(f.toLowerCase()));
      const subjectMatch = subjectFilters.some(f => subject.includes(f.toLowerCase()));

      if (senderMatch || subjectMatch) {
        const code = extractVerificationCode(subject + ' ' + digest);
        if (code) {
          if (excludedCodeSet.has(code)) {
            log(`步骤 ${step}：跳过排除的验证码：${code}`, 'info');
            continue;
          }
          const source = useFallback && existingMailIds.has(mailId) ? '回退首封匹配邮件' : '新邮件';
          log(`步骤 ${step}：已找到验证码：${code}（来源：${source}，主题：${subject.slice(0, 40)}）`, 'ok');
          return { ok: true, code, emailTimestamp: Date.now(), mailId };
        }
      }
    }

    if (attempt === FALLBACK_AFTER + 1) {
      log(`步骤 ${step}：连续 ${FALLBACK_AFTER} 次未发现新邮件，开始回退到首封匹配邮件`, 'warn');
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `${(maxAttempts * intervalMs / 1000).toFixed(0)} 秒后仍未找到新的匹配邮件。` +
    '请手动检查 QQ 邮箱，邮件可能延迟到达或进入垃圾箱。'
  );
}

// ============================================================
// Inbox Refresh
// ============================================================

async function refreshInbox() {
  // Try multiple strategies to refresh the mail list

  // Strategy 1: Click any visible refresh button
  const refreshBtn = document.querySelector('[class*="refresh"], [title*="刷新"]');
  if (refreshBtn) {
    simulateClick(refreshBtn);
    console.log(QQ_MAIL_PREFIX, 'Clicked refresh button');
    await sleep(500);
    return;
  }

  // Strategy 2: Click inbox in sidebar to reload list
  const sidebarInbox = document.querySelector('a[href*="inbox"], [class*="folder-item"][class*="inbox"], [title="收件箱"]');
  if (sidebarInbox) {
    simulateClick(sidebarInbox);
    console.log(QQ_MAIL_PREFIX, 'Clicked sidebar inbox');
    await sleep(500);
    return;
  }

  // Strategy 3: Click the folder name in toolbar
  const folderName = document.querySelector('.toolbar-folder-name');
  if (folderName) {
    simulateClick(folderName);
    console.log(QQ_MAIL_PREFIX, 'Clicked toolbar folder name');
    await sleep(500);
  }
}

// ============================================================
// Verification Code Extraction
// ============================================================

function extractVerificationCode(text) {
  // Pattern 1: Chinese format "代码为 370794" or "验证码...370794"
  const matchCn = text.match(/(?:代码为|验证码[^0-9]*?)[\s：:]*(\d{6})/);
  if (matchCn) return matchCn[1];

  // Pattern 2: English format "code is 370794" or "code: 370794"
  const matchEn = text.match(/code[:\s]+is[:\s]+(\d{6})|code[:\s]+(\d{6})/i);
  if (matchEn) return matchEn[1] || matchEn[2];

  // Pattern 3: standalone 6-digit number (first occurrence)
  const match6 = text.match(/\b(\d{6})\b/);
  if (match6) return match6[1];

  return null;
}
