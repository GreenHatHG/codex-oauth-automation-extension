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
const QQ_ALIAS_VERIFY_OPTION_TEXT_SELECTOR = 'p';
const QQ_ALIAS_DELETE_TRIGGER_SELECTOR = '#container > div > div.wrapper > div.home > div.home_mainWrapper > div > div.home_content > div > div.account > div:nth-child(4) > div.account_item_control > span';
const QQ_ALIAS_DELETE_CONFIRM_CHECKBOX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_before > div.delAlias_before_checkbox > div';
const QQ_ALIAS_DELETE_CONFIRM_BUTTON_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_before > div.delAlias_before_control > button';
const QQ_ALIAS_VERIFY_PHONE_TEXT_PATTERN = /使用\s*手机号码.*接收短信验证/i;
const QQ_ALIAS_VERIFY_PHONE_INPUT_BOX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox';
const QQ_ALIAS_VERIFY_PHONE_PREFIX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox > span.verify_phone_box > span:nth-child(1)';
const QQ_ALIAS_VERIFY_PHONE_SUFFIX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox > span.verify_phone_box > span:nth-child(2)';
const QQ_ALIAS_VERIFY_PHONE_DISPLAY_PREFIX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox > span.verify_phone_number > span:nth-child(1)';
const QQ_ALIAS_VERIFY_PHONE_DISPLAY_SUFFIX_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox > span.verify_phone_number > span:nth-child(2)';
const QQ_ALIAS_VERIFY_PHONE_INPUT_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_phone > div.verify_phone_inputBox > input.verify_phone_input';
const QQ_ALIAS_REQUEST_SMS_CODE_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_bottom > button';
const QQ_ALIAS_SUBMIT_AUTH_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.verify_inner > div.verify_code_bottom > button';
const QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.delAlias_confirm > div.delAlias_confirm_control > button';
const QQ_ALIAS_OPEN_TRIGGER_SELECTOR = '#container > div > div.wrapper > div.home > div.home_mainWrapper > div > div.home_content > div > div.account > div:nth-child(4) > div > span.account_item_mail > button';
const QQ_ALIAS_OPEN_TRIGGER_FALLBACK_SELECTOR = '.account_item_mail button, [class*="account_item_mail"] button';
const QQ_ALIAS_ACCOUNT_ITEM_SELECTOR = '.account [class*="account_item"], .home_content .account > div';
const QQ_ALIAS_INPUT_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_mail > div.open_mail_inner > div > input';
const QQ_ALIAS_OPEN_ERROR_TIP_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_mail > div.open_mail_tip.open_mail_errorTip > span';
const QQ_ALIAS_OPEN_ERROR_CONTAINER_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_mail > div.open_mail_tip.open_mail_errorTip';
const QQ_ALIAS_AGREE_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_protocol > div.xmail-ui-checkbox > div';
const QQ_ALIAS_OPEN_CONFIRM_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div.open > div.open_confirm > div > div';
const QQ_ALIAS_COPY_SELECTOR = '#container > div > div.wrapper > div.common-wrapper > div > div.succ > div > div > span.succ_acct_copy';
const QQ_ALIAS_OPEN_TRIGGER_TEXT_PATTERN = /重新申请|重新开通|申请.*(?:英文邮箱|别名)|开通.*(?:英文邮箱|别名)|创建.*(?:英文邮箱|别名)|英文邮箱/i;
const QQ_ALIAS_ACCOUNT_ITEM_TEXT_PATTERN = /英文邮箱|邮箱别名|别名邮箱|英文别名|英文账号|英文帐号/i;
const QQ_ALIAS_OPEN_ACTION_TEXT_PATTERN = /重新申请|重新开通|申请|开通|新增|添加|创建|立即开通|去开通/i;
const QQ_ALIAS_OPEN_TRIGGER_CANDIDATE_SELECTOR = 'button, [role="button"], a, span, div';
const QQ_ALIAS_ACCOUNT_PATH_PATTERN = /\/account\/index(?:[/?#]|$)/i;
const QQ_ALIAS_ACCOUNT_STATE_WAIT_TIMEOUT_MS = 20000;
const QQ_ALIAS_OPEN_READY_WAIT_MS = 45000;
const QQ_ALIAS_UI_ACTION_PREPARE_MIN_MS = 280;
const QQ_ALIAS_UI_ACTION_PREPARE_MAX_MS = 780;
const QQ_ALIAS_UI_ACTION_SETTLE_MIN_MS = 320;
const QQ_ALIAS_UI_ACTION_SETTLE_MAX_MS = 920;
const QQ_ALIAS_UI_FIELD_PREPARE_MIN_MS = 140;
const QQ_ALIAS_UI_FIELD_PREPARE_MAX_MS = 360;
const QQ_ALIAS_UI_FIELD_SETTLE_MIN_MS = 120;
const QQ_ALIAS_UI_FIELD_SETTLE_MAX_MS = 280;
const QQ_ALIAS_SLIDER_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[id*="tcaptcha"]',
  'iframe[name*="tcaptcha"]',
  '#tcaptcha_iframe',
  '#tcaptcha_iframe_dy',
  '[id*="tcaptcha"]',
  '[class*="tcaptcha"]',
];
const QQ_ALIAS_MANUAL_SMS_WAIT_MS = 300000;
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
  await pauseQqAliasUiAction();
  simulateClick(element);
  if (label) {
    log(`QQ 别名：已点击${label}`);
  }
  await settleQqAliasUiAction();
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

function findVisibleDescendantByText(root, selector, pattern) {
  if (!root) {
    return null;
  }

  const normalizedPattern = pattern instanceof RegExp ? pattern : new RegExp(String(pattern || ''), 'i');
  const candidates = root.querySelectorAll(selector);
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

function getVisibleDescendant(root, selector) {
  if (!root) {
    return null;
  }

  const candidates = root.querySelectorAll(selector);
  for (const candidate of candidates) {
    if (isVisibleElement(candidate)) {
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
      await pauseQqAliasUiAction();
      simulateClick(target);
      if (label) {
        log(`QQ 别名：已点击${label}`);
      }
      await settleQqAliasUiAction();
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

function getQqAliasVerifyPhoneTargets() {
  const popup = getVisibleElement(QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR);
  if (!popup) {
    return [];
  }

  const optionText = [...popup.querySelectorAll(QQ_ALIAS_VERIFY_OPTION_TEXT_SELECTOR)].find(
    (element) => isVisibleElement(element) && isTextMatched(element, QQ_ALIAS_VERIFY_PHONE_TEXT_PATTERN)
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

function getQqAliasVerifyPhoneTargetsReady() {
  return Boolean(
    getVisibleElement(QQ_ALIAS_VERIFY_PHONE_INPUT_BOX_SELECTOR)
    && getVisibleElement(QQ_ALIAS_VERIFY_PHONE_PREFIX_SELECTOR)
    && getVisibleElement(QQ_ALIAS_VERIFY_PHONE_SUFFIX_SELECTOR)
    && document.querySelector(QQ_ALIAS_VERIFY_PHONE_DISPLAY_PREFIX_SELECTOR)
    && document.querySelector(QQ_ALIAS_VERIFY_PHONE_DISPLAY_SUFFIX_SELECTOR)
    && document.querySelector(QQ_ALIAS_VERIFY_PHONE_INPUT_SELECTOR)
  );
}

function getQqAliasRequestSmsCodeButton() {
  const button = getVisibleElement(QQ_ALIAS_REQUEST_SMS_CODE_SELECTOR);
  if (!button) {
    return null;
  }

  const ariaDisabled = String(button.getAttribute('aria-disabled') || '').trim().toLowerCase();
  if (button.disabled || ariaDisabled === 'true') {
    return null;
  }
  return button;
}

function getElementDisplayValue(element) {
  if (!element) {
    return '';
  }

  if (typeof element.value === 'string') {
    return String(element.value || '').trim();
  }

  return String(element.textContent || '').replace(/\s+/g, '').trim();
}

function normalizeQqAliasPhoneFragments(rawValue = '') {
  const digits = String(rawValue || '').replace(/\D+/g, '');
  if (digits.length === 2) {
    return {
      prefix: digits.slice(0, 1),
      suffix: digits.slice(1, 2),
    };
  }

  if (digits.length === 11) {
    return {
      prefix: digits.slice(0, 1),
      suffix: digits.slice(-1),
    };
  }

  if (digits.length === 13 && digits.startsWith('86')) {
    return {
      prefix: digits.slice(2, 3),
      suffix: digits.slice(-1),
    };
  }

  return null;
}

function getQqAliasVerifyPhoneInput() {
  return document.querySelector(QQ_ALIAS_VERIFY_PHONE_INPUT_SELECTOR) || null;
}

function getQqAliasVerifyPhoneDisplayValue() {
  const prefix = getElementDisplayValue(document.querySelector(QQ_ALIAS_VERIFY_PHONE_DISPLAY_PREFIX_SELECTOR));
  const suffix = getElementDisplayValue(document.querySelector(QQ_ALIAS_VERIFY_PHONE_DISPLAY_SUFFIX_SELECTOR));
  return `${prefix}${suffix}`;
}

function clearQqAliasPhoneInputValue(input) {
  if (!input) {
    return;
  }

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  nativeInputValueSetter?.call(input, '');
  input.setAttribute('value', '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function focusQqAliasPhoneInput(inputBox, input) {
  const focusTarget = inputBox || input;
  if (focusTarget && typeof focusTarget.focus === 'function') {
    focusTarget.focus({ preventScroll: true });
  }
  if (input && typeof input.focus === 'function') {
    input.focus({ preventScroll: true });
  }
}

function tryExecCommandInsertText(input, digit) {
  if (!input || typeof document.execCommand !== 'function') {
    return false;
  }

  try {
    focusQqAliasPhoneInput(input.parentElement, input);
    return document.execCommand('insertText', false, String(digit || '').trim());
  } catch (_error) {
    return false;
  }
}

function getQqAliasPhoneDebugSummary() {
  const input = getQqAliasVerifyPhoneInput();
  const requestButton = document.querySelector(QQ_ALIAS_REQUEST_SMS_CODE_SELECTOR);
  const activeElement = document.activeElement;
  const activeLabel = activeElement
    ? `${activeElement.tagName.toLowerCase()}.${activeElement.className || ''}`.replace(/\s+/g, '.')
    : 'none';
  const requestButtonState = requestButton
    ? String(Boolean(
      requestButton.disabled
      || String(requestButton.getAttribute('aria-disabled') || '').trim().toLowerCase() === 'true'
    ))
    : 'missing';
  return `input=${JSON.stringify(String(input?.value || ''))}, display=${JSON.stringify(getQqAliasVerifyPhoneDisplayValue())}, requestDisabled=${requestButtonState}, active=${activeLabel}`;
}

async function pauseQqAliasUiAction(min = QQ_ALIAS_UI_ACTION_PREPARE_MIN_MS, max = QQ_ALIAS_UI_ACTION_PREPARE_MAX_MS) {
  await humanPause(min, max);
}

async function settleQqAliasUiAction(min = QQ_ALIAS_UI_ACTION_SETTLE_MIN_MS, max = QQ_ALIAS_UI_ACTION_SETTLE_MAX_MS) {
  await humanPause(min, max);
}

async function pauseQqAliasFieldAction(min = QQ_ALIAS_UI_FIELD_PREPARE_MIN_MS, max = QQ_ALIAS_UI_FIELD_PREPARE_MAX_MS) {
  await humanPause(min, max);
}

async function settleQqAliasFieldAction(min = QQ_ALIAS_UI_FIELD_SETTLE_MIN_MS, max = QQ_ALIAS_UI_FIELD_SETTLE_MAX_MS) {
  await humanPause(min, max);
}

async function waitForQqAliasPhoneDigitDisplay(selector, expectedDigit, timeout = 2500) {
  const endAt = Date.now() + timeout;
  const normalizedDigit = String(expectedDigit || '').trim();
  while (Date.now() < endAt) {
    throwIfStopped();
    const displayValue = getElementDisplayValue(document.querySelector(selector));
    if (displayValue === normalizedDigit) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function getQqAliasOpenTrigger() {
  const directTrigger = getVisibleElement(QQ_ALIAS_OPEN_TRIGGER_SELECTOR)
    || findVisibleElementByText(QQ_ALIAS_OPEN_TRIGGER_CANDIDATE_SELECTOR, QQ_ALIAS_OPEN_TRIGGER_TEXT_PATTERN);
  if (directTrigger) {
    return directTrigger;
  }

  if (!QQ_ALIAS_ACCOUNT_PATH_PATTERN.test(String(location.pathname || ''))) {
    return null;
  }

  const fallbackButton = getVisibleElement(QQ_ALIAS_OPEN_TRIGGER_FALLBACK_SELECTOR);
  if (fallbackButton && !getVisibleElement(QQ_ALIAS_DELETE_TRIGGER_SELECTOR)) {
    return fallbackButton;
  }

  const accountItems = [...document.querySelectorAll(QQ_ALIAS_ACCOUNT_ITEM_SELECTOR)].filter(isVisibleElement);
  const aliasAccountItem = accountItems.find((element) => isTextMatched(element, QQ_ALIAS_ACCOUNT_ITEM_TEXT_PATTERN));
  if (!aliasAccountItem) {
    return null;
  }

  const textMatchedTrigger = findVisibleDescendantByText(
    aliasAccountItem,
    QQ_ALIAS_OPEN_TRIGGER_CANDIDATE_SELECTOR,
    QQ_ALIAS_OPEN_ACTION_TEXT_PATTERN
  );
  if (textMatchedTrigger) {
    return textMatchedTrigger;
  }

  if (getVisibleElement(QQ_ALIAS_DELETE_TRIGGER_SELECTOR)) {
    return null;
  }

  return getVisibleDescendant(aliasAccountItem, QQ_ALIAS_OPEN_TRIGGER_FALLBACK_SELECTOR)
    || getVisibleDescendant(aliasAccountItem, 'button, [role="button"], a');
}

async function waitForQqAliasAccountState(timeout = QQ_ALIAS_ACCOUNT_STATE_WAIT_TIMEOUT_MS) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();
    if (getVisibleElement(QQ_ALIAS_DELETE_TRIGGER_SELECTOR)) {
      return { kind: 'delete_trigger' };
    }

    if (getQqAliasOpenTrigger()) {
      return { kind: 'open_trigger' };
    }

    await sleep(200);
  }

  throw new Error(`等待 QQ 别名页面状态超时：${QQ_ALIAS_DELETE_TRIGGER_SELECTOR} / ${QQ_ALIAS_OPEN_TRIGGER_SELECTOR}`);
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

function getQqAliasOpenErrorMessage() {
  const tip = getVisibleElement(QQ_ALIAS_OPEN_ERROR_TIP_SELECTOR)
    || getVisibleElement(QQ_ALIAS_OPEN_ERROR_CONTAINER_SELECTOR);
  if (!tip) {
    return '';
  }

  return String(tip.textContent || '').replace(/\s+/g, ' ').trim();
}

async function waitForQqAliasReadyForOpenNewAlias(timeout = QQ_ALIAS_OPEN_READY_WAIT_MS) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();
    const readyState = getQqAliasReadyForOpenNewAliasState();
    if (readyState) {
      return readyState;
    }
    await sleep(250);
  }

  throw new Error(`等待 QQ 别名新增入口超时：${QQ_ALIAS_OPEN_TRIGGER_SELECTOR} / ${QQ_ALIAS_INPUT_SELECTOR}`);
}

async function waitForQqAliasOpenOutcome(timeout = 20000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();

    if (getVisibleElement(QQ_ALIAS_COPY_SELECTOR)) {
      return { kind: 'success' };
    }

    const errorMessage = getQqAliasOpenErrorMessage();
    if (errorMessage) {
      return {
        kind: 'error',
        message: errorMessage,
      };
    }

    await sleep(250);
  }

  throw new Error(`等待 QQ 别名开通结果超时：${QQ_ALIAS_COPY_SELECTOR} / ${QQ_ALIAS_OPEN_ERROR_TIP_SELECTOR}`);
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
      await pauseQqAliasUiAction();
      simulateClick(resolveClickableTextTarget(trigger));
      log('QQ 别名：已点击新增别名入口');
      await settleQqAliasUiAction();
      return trigger;
    }
    await sleep(200);
  }

  throw new Error('没有找到可用的别名新增入口。');
}

async function waitForQqAliasVerifyPhoneReady(timeout = 1500) {
  const endAt = Date.now() + timeout;
  while (Date.now() < endAt) {
    throwIfStopped();
    if (getQqAliasVerifyPhoneTargetsReady()) {
      return true;
    }
    await sleep(120);
  }
  return null;
}

async function clickQqAliasVerifyPhoneOption(timeout = 15000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();

    const targets = getQqAliasVerifyPhoneTargets();
    for (const target of targets) {
      await pauseQqAliasUiAction();
      simulateClick(target);
      if (await waitForQqAliasVerifyPhoneReady(1500)) {
        await settleQqAliasUiAction();
        log('QQ 别名：已点击手机短信验证');
        return target;
      }

      dispatchQqAliasMouseSequence(target);
      if (await waitForQqAliasVerifyPhoneReady(1800)) {
        await settleQqAliasUiAction();
        log('QQ 别名：已点击手机短信验证');
        return target;
      }
    }

    if (!getVisibleElement(QQ_ALIAS_VERIFY_METHOD_POPUP_SELECTOR)) {
      await clickQqAliasVerifyMore(Math.max(1500, endAt - Date.now()));
    }

    await sleep(150);
  }

  throw new Error('已尝试点击“使用手机号码接收短信验证”，但没有进入短信验证页面。');
}

async function fillQqAliasPhoneDigits(phoneDigits, timeout = 15000) {
  const normalizedDigits = String(phoneDigits || '').trim();
  if (normalizedDigits.length < 2) {
    throw new Error('QQ 别名手机号补全数字为空。');
  }

  const currentDisplayValue = getQqAliasVerifyPhoneDisplayValue();
  if (currentDisplayValue === normalizedDigits) {
    log('QQ 别名：已填写手机号补全数字');
    return true;
  }

  const input = getQqAliasVerifyPhoneInput();
  if (!input) {
    throw new Error('QQ 别名手机号输入框不存在。');
  }

  const inputBox = await waitForVisibleSelector(QQ_ALIAS_VERIFY_PHONE_INPUT_BOX_SELECTOR, timeout);

  async function inputSingleDigit(digit, displaySelector, label) {
    const normalizedDigit = String(digit || '').trim();
    if (!normalizedDigit) {
      throw new Error(`QQ 别名${label}为空。`);
    }

    const currentDigit = getElementDisplayValue(document.querySelector(displaySelector));
    if (currentDigit === normalizedDigit) {
      log(`QQ 别名：已填写${label}`);
      return;
    }

    await pauseQqAliasFieldAction();
    simulateClick(inputBox);
    dispatchQqAliasMouseSequence(inputBox);
    await settleQqAliasFieldAction();
    clearQqAliasPhoneInputValue(input);
    focusQqAliasPhoneInput(inputBox, input);
    await settleQqAliasFieldAction();
    tryExecCommandInsertText(input, normalizedDigit);
    const displayed = await waitForQqAliasPhoneDigitDisplay(displaySelector, normalizedDigit, 1500);
    if (displayed) {
      log(`QQ 别名：已用 execCommand 策略填写${label}`);
      log(`QQ 别名：已填写${label}`);
      return;
    }

    log(`QQ 别名：execCommand 策略未能填写${label}，${getQqAliasPhoneDebugSummary()}`, 'info');
    clearQqAliasPhoneInputValue(input);
    throw new Error(`QQ 别名${label}填写失败，请确认当前页面仍在短信验证页。${getQqAliasPhoneDebugSummary()}`);
  }

  await inputSingleDigit(normalizedDigits[0], QQ_ALIAS_VERIFY_PHONE_DISPLAY_PREFIX_SELECTOR, '手机号第一个数字');
  await inputSingleDigit(normalizedDigits[1], QQ_ALIAS_VERIFY_PHONE_DISPLAY_SUFFIX_SELECTOR, '手机号第二个数字');
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  if (typeof input.blur === 'function') {
    input.blur();
  }

  const filled = getQqAliasVerifyPhoneDisplayValue() === normalizedDigits;
  if (!filled) {
    throw new Error('QQ 别名手机号补全数字填写失败，请确认当前页面仍在短信验证页。');
  }

  log('QQ 别名：已填写手机号补全数字');
  return true;
}

async function clickQqAliasRequestSmsCode(timeout = 15000) {
  const endAt = Date.now() + timeout;

  while (Date.now() < endAt) {
    throwIfStopped();
    const button = getQqAliasRequestSmsCodeButton();
    if (button) {
      await pauseQqAliasUiAction();
      simulateClick(button);
      if (await waitForVisibleSelectorSafely(QQ_ALIAS_SUBMIT_AUTH_SELECTOR, 8000)) {
        await settleQqAliasUiAction();
        log('QQ 别名：短信验证码已请求成功，可以开始等待接收短信。', 'warn');
        return button;
      }
    }
    await sleep(150);
  }

  throw new Error('已进入短信验证页面，但“获取验证码”按钮未就绪。');
}

async function waitForQqAliasPostVerificationState(timeout = QQ_ALIAS_MANUAL_SMS_WAIT_MS) {
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

async function autoAdvanceQqAliasAfterManualSmsCode() {
  const initialState = await waitForAnyVisibleSelectorSafely([
    QQ_ALIAS_SUBMIT_AUTH_SELECTOR,
    QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR,
  ], 20000);
  if (!initialState) {
    return {
      pendingAction: { reason: 'sms_code' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN,
    };
  }

  if (initialState.selector === QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR) {
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

  log('QQ 别名：请等待接收短信，收到后在当前页面输入验证码并点击提交验证，脚本会自动继续。', 'warn');

  const postVerificationState = await waitForQqAliasPostVerificationState();
  if (!postVerificationState) {
    return {
      pendingAction: { reason: 'sms_code' },
      continueStage: QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN,
    };
  }

  if (postVerificationState.kind !== 'final_delete') {
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
      await settleQqAliasUiAction();
      log('QQ 别名：已点击更多验证方式');
      return getVisibleElement(QQ_ALIAS_VERIFY_MORE_TRIGGER_SELECTOR);
    }

    const targets = getQqAliasVerifyMoreTargets();
    for (const target of targets) {
      await pauseQqAliasUiAction();
      simulateClick(target);
      if (await waitForQqAliasVerifyMethodMenu(500)) {
        await settleQqAliasUiAction();
        log('QQ 别名：已点击更多验证方式');
        return target;
      }

      dispatchQqAliasMouseSequence(target);
      if (await waitForQqAliasVerifyMethodMenu(700)) {
        await settleQqAliasUiAction();
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

async function prepareQqAliasSmsVerification(phoneNumber) {
  const normalizedPhone = normalizeQqAliasPhoneFragments(phoneNumber);
  if (!normalizedPhone) {
    throw new Error('QQ 别名短信验证缺少有效手机号补全数字，请填写两个数字，例如 18。');
  }

  await clickQqAliasVerifyMore();
  await clickQqAliasVerifyPhoneOption();
  await fillQqAliasPhoneDigits(`${normalizedPhone.prefix}${normalizedPhone.suffix}`);
  await clickQqAliasRequestSmsCode(20000);
  return autoAdvanceQqAliasAfterManualSmsCode();
}

async function handleQqAliasFlow(payload = {}) {
  const stage = String(payload.stage || '').trim();
  switch (stage) {
    case QQ_ALIAS_FLOW_STAGE_START:
      return startQqAliasFlow(payload);
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

async function startQqAliasFlow(payload = {}) {
  log('QQ 别名：正在检查当前账号是否已有旧别名...');
  const accountState = await waitForQqAliasAccountState();

  if (accountState.kind === 'open_trigger') {
    log('QQ 别名：当前没有旧别名，准备直接申请新别名。', 'ok');
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  await clickVisibleSelector(QQ_ALIAS_DELETE_TRIGGER_SELECTOR, '删除旧别名');
  await clickVisibleSelector(QQ_ALIAS_DELETE_CONFIRM_CHECKBOX_SELECTOR, '删除确认复选框');
  await clickVisibleSelector(QQ_ALIAS_DELETE_CONFIRM_BUTTON_SELECTOR, '继续删除');
  return prepareQqAliasSmsVerification(payload.phoneNumber);
}

async function continueQqAliasAfterToken() {
  if (getQqAliasReadyForOpenNewAliasState()) {
    return { nextStage: QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS };
  }

  if (getVisibleElement(QQ_ALIAS_SUBMIT_AUTH_SELECTOR)) {
    await clickVisibleSelector(QQ_ALIAS_SUBMIT_AUTH_SELECTOR, '提交验证', 20000);
  }

  const confirmDeleteButton = await waitForVisibleSelectorSafely(QQ_ALIAS_FINAL_DELETE_BUTTON_SELECTOR, 20000);
  if (!confirmDeleteButton) {
    return {
      pendingAction: { reason: 'sms_code' },
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

  const initialReadyState = getQqAliasReadyForOpenNewAliasState();
  if (initialReadyState?.kind === 'success') {
    return {
      email: `${localPart}@qq.com`,
    };
  }

  const readyState = initialReadyState || await waitForQqAliasReadyForOpenNewAlias();
  if (readyState.kind === 'success') {
    return {
      email: `${localPart}@qq.com`,
    };
  }

  if (readyState.kind === 'open_trigger') {
    await clickQqAliasOpenTrigger(20000);
  }

  const input = await waitForVisibleSelector(QQ_ALIAS_INPUT_SELECTOR, 15000);
  fillInput(input, localPart);
  await settleQqAliasFieldAction();
  await clickVisibleSelector(QQ_ALIAS_AGREE_SELECTOR, '同意协议');
  await clickVisibleSelector(QQ_ALIAS_OPEN_CONFIRM_SELECTOR, '继续开通');
  const openOutcome = await waitForQqAliasOpenOutcome(20000);
  if (openOutcome.kind === 'error') {
    throw new Error(`QQ 别名开通失败：${openOutcome.message}`);
  }
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
