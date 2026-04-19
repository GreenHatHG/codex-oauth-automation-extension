(function attachGeneratedEmailHelpers(root, factory) {
  root.MultiPageGeneratedEmailHelpers = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createGeneratedEmailHelpersModule() {
  function createGeneratedEmailHelpers(deps = {}) {
    const {
      addLog,
      buildGeneratedAliasEmail,
      buildCloudflareTempEmailHeaders,
      CLOUDFLARE_TEMP_EMAIL_GENERATOR,
      DUCK_AUTOFILL_URL,
      fetch,
      fetchIcloudHideMyEmail,
      clearQqAliasFlowState,
      getCloudflareTempEmailAddressFromResponse,
      getCloudflareTempEmailConfig,
      getState,
      joinCloudflareTempEmailUrl,
      normalizeCloudflareDomain,
      normalizeCloudflareTempEmailAddress,
      normalizeEmailGenerator,
      isGeneratedAliasProvider,
      getQqAliasAccountUrl,
      QQ_ALIAS_ACCOUNT_URL,
      QQ_ALIAS_EMAIL_GENERATOR,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      setQqAliasPendingAction,
      sendToContentScript,
      setEmailState,
      throwIfStopped,
    } = deps;
    const QQ_ALIAS_FLOW_MESSAGE_TYPE = 'QQ_ALIAS_FLOW';
    const QQ_ALIAS_FLOW_STAGE_START = 'start';
    const QQ_ALIAS_FLOW_STAGE_AFTER_TOKEN = 'after_token';
    const QQ_ALIAS_FLOW_STAGE_AFTER_SLIDER = 'after_slider';
    const QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS = 'open_new_alias';
    const QQ_ALIAS_FLOW_TIMEOUT_MS = 660000;
    const QQ_ALIAS_CONTINUE_LABEL = '我已处理，继续';

    function generateCloudflareAliasLocalPart() {
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const digits = '0123456789';
      const chars = [];

      for (let i = 0; i < 6; i++) {
        chars.push(letters[Math.floor(Math.random() * letters.length)]);
      }

      for (let i = 0; i < 4; i++) {
        chars.push(digits[Math.floor(Math.random() * digits.length)]);
      }

      for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }

      return chars.join('');
    }

    function buildEmailResult(email = '') {
      return { email: String(email || '').trim() };
    }

    function generateQqAliasLocalPart(length = 10) {
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const chars = [];
      for (let i = 0; i < length; i++) {
        chars.push(letters[Math.floor(Math.random() * letters.length)]);
      }
      return chars.join('');
    }

    function buildQqAliasPendingAction(pendingAction = {}) {
      const reason = typeof pendingAction === 'string'
        ? pendingAction
        : String(pendingAction?.reason || '').trim();
      if (reason === 'token_input') {
        return {
          id: Date.now(),
          title: '手动处理 QQ 令牌',
          message: 'QQ 别名等待超时，请在 QQ 邮箱页中输入 QQ 令牌，完成后回到面板点击“继续”。',
          continueLabel: QQ_ALIAS_CONTINUE_LABEL,
        };
      }
      if (reason === 'slider') {
        return {
          id: Date.now(),
          title: '手动处理滑块验证',
          message: 'QQ 别名等待超时，请在 QQ 邮箱页中完成滑块验证，完成后回到面板点击“继续”。',
          continueLabel: QQ_ALIAS_CONTINUE_LABEL,
        };
      }

      const title = String(pendingAction?.title || '').trim();
      const message = String(pendingAction?.message || '').trim();
      if (!title || !message) {
        throw new Error('QQ 别名流程未返回可识别的人工确认信息。');
      }

      return {
        id: Date.now(),
        title,
        message,
        continueLabel: String(pendingAction?.continueLabel || '').trim() || QQ_ALIAS_CONTINUE_LABEL,
      };
    }

    async function dispatchQqAliasFlow(stage, payload = {}) {
      throwIfStopped();
      const normalizedStage = String(stage || '').trim();
      if (!normalizedStage) {
        throw new Error('QQ 别名流程阶段为空。');
      }

      if (normalizedStage === QQ_ALIAS_FLOW_STAGE_START || normalizedStage === QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS) {
        const qqAliasAccountUrl = typeof getQqAliasAccountUrl === 'function'
          ? await getQqAliasAccountUrl()
          : QQ_ALIAS_ACCOUNT_URL;
        await reuseOrCreateTab('qq-mail', qqAliasAccountUrl, { reloadIfSameUrl: true });
      }

      const message = {
        type: QQ_ALIAS_FLOW_MESSAGE_TYPE,
        source: 'background',
        payload: {
          stage: normalizedStage,
          ...payload,
        },
      };

      if (typeof sendToContentScriptResilient === 'function') {
        return sendToContentScriptResilient('qq-mail', message, {
          timeoutMs: QQ_ALIAS_FLOW_TIMEOUT_MS,
          responseTimeoutMs: QQ_ALIAS_FLOW_TIMEOUT_MS,
          retryDelayMs: 700,
          logMessage: 'QQ 邮箱页正在切换，等待页面重新就绪后继续执行别名流程...',
        });
      }

      return sendToContentScript('qq-mail', message);
    }

    async function finalizeQqAliasEmail(email = '') {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        throw new Error('QQ 别名流程未返回可用邮箱。');
      }
      await setEmailState(normalizedEmail);
      await clearQqAliasFlowState({ lastGeneratedEmail: normalizedEmail });
      await addLog(`QQ 别名：已生成 ${normalizedEmail}`, 'ok');
      return buildEmailResult(normalizedEmail);
    }

    async function handleQqAliasStageResult(result, options = {}) {
      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.pendingAction) {
        const pendingAction = await setQqAliasPendingAction(
          buildQqAliasPendingAction(result.pendingAction),
          result.continueStage
        );
        await addLog(`QQ 别名：${pendingAction.message}`, 'warn');
        return { pendingAction };
      }

      if (result?.nextStage === QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS) {
        return dispatchQqAliasFlow(QQ_ALIAS_FLOW_STAGE_OPEN_NEW_ALIAS, {
          localPart: String(options.localPart || '').trim().toLowerCase() || generateQqAliasLocalPart(),
        }).then((nextResult) => handleQqAliasStageResult(nextResult));
      }

      if (result?.email) {
        return finalizeQqAliasEmail(result.email);
      }

      throw new Error('QQ 别名流程未返回可识别结果。');
    }

    async function fetchQqAliasEmail(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const provider = String(options.mailProvider || latestState?.mailProvider || '').trim().toLowerCase();
      if (provider !== 'qq') {
        throw new Error('QQ 别名仅支持在 QQ 邮箱服务下使用。');
      }

      await clearQqAliasFlowState();
      await addLog('QQ 别名：正在打开邮箱设置页并准备处理旧别名...', 'info');
      const result = await dispatchQqAliasFlow(QQ_ALIAS_FLOW_STAGE_START);
      return handleQqAliasStageResult(result);
    }

    async function continueQqAliasFlow(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const continueStage = String(options.continueStage || latestState?.qqAliasContinueStage || '').trim();
      if (!continueStage) {
        throw new Error('当前没有可继续的 QQ 别名流程。');
      }

      await clearQqAliasFlowState();
      await addLog('QQ 别名：正在继续处理人工确认后的流程...', 'info');
      const result = await dispatchQqAliasFlow(continueStage);
      return handleQqAliasStageResult(result);
    }

    async function fetchCloudflareEmail(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const domain = normalizeCloudflareDomain(latestState.cloudflareDomain);
      if (!domain) {
        throw new Error('Cloudflare 域名为空或格式无效。');
      }

      const localPart = String(options.localPart || '').trim().toLowerCase() || generateCloudflareAliasLocalPart();
      const aliasEmail = `${localPart}@${domain}`;

      await setEmailState(aliasEmail);
      await addLog(`Cloudflare 邮箱：已生成 ${aliasEmail}`, 'ok');
      return aliasEmail;
    }

    function ensureCloudflareTempEmailConfig(state, options = {}) {
      const {
        requireAdminAuth = false,
        requireDomain = false,
      } = options;
      const config = getCloudflareTempEmailConfig(state);
      if (!config.baseUrl) {
        throw new Error('Cloudflare Temp Email 服务地址为空或格式无效。');
      }
      if (requireAdminAuth && !config.adminAuth) {
        throw new Error('Cloudflare Temp Email 缺少 Admin Auth。');
      }
      if (requireDomain && !config.domain) {
        throw new Error('Cloudflare Temp Email 域名为空或格式无效。');
      }
      return config;
    }

    async function requestCloudflareTempEmailJson(config, path, options = {}) {
      const {
        method = 'GET',
        payload,
        searchParams,
        timeoutMs = 20000,
      } = options;

      const url = new URL(joinCloudflareTempEmailUrl(config.baseUrl, path));
      if (searchParams && typeof searchParams === 'object') {
        for (const [key, value] of Object.entries(searchParams)) {
          if (value === undefined || value === null || value === '') continue;
          url.searchParams.set(key, String(value));
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

      let response;
      try {
        response = await fetch(url.toString(), {
          method,
          headers: buildCloudflareTempEmailHeaders(config, {
            json: payload !== undefined,
          }),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        const errorMessage = err?.name === 'AbortError'
          ? `Cloudflare Temp Email 请求超时（>${Math.round(timeoutMs / 1000)} 秒）`
          : `Cloudflare Temp Email 请求失败：${err.message}`;
        throw new Error(errorMessage);
      } finally {
        clearTimeout(timeoutId);
      }

      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = text;
      }

      if (!response.ok) {
        const payloadError = typeof parsed === 'object' && parsed
          ? (parsed.message || parsed.error || parsed.msg)
          : '';
        throw new Error(`Cloudflare Temp Email 请求失败：${payloadError || text || `HTTP ${response.status}`}`);
      }

      return parsed;
    }

    async function fetchCloudflareTempEmailAddress(state, options = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const config = ensureCloudflareTempEmailConfig(latestState, {
        requireAdminAuth: true,
        requireDomain: true,
      });
      const requestedName = String(options.localPart || options.name || '').trim().toLowerCase() || generateCloudflareAliasLocalPart();
      const payload = {
        enablePrefix: true,
        name: requestedName,
        domain: config.domain,
      };
      const result = await requestCloudflareTempEmailJson(config, '/admin/new_address', {
        method: 'POST',
        payload,
      });
      const address = normalizeCloudflareTempEmailAddress(getCloudflareTempEmailAddressFromResponse(result));
      if (!address) {
        throw new Error('Cloudflare Temp Email 未返回可用邮箱地址。');
      }

      await setEmailState(address);
      await addLog(`Cloudflare Temp Email：已生成 ${address}`, 'ok');
      return address;
    }

    async function fetchDuckEmail(options = {}) {
      throwIfStopped();
      const { generateNew = true } = options;

      await addLog(`Duck 邮箱：正在打开自动填充设置（${generateNew ? '生成新地址' : '复用当前地址'}）...`);
      await reuseOrCreateTab('duck-mail', DUCK_AUTOFILL_URL);

      const result = await sendToContentScript('duck-mail', {
        type: 'FETCH_DUCK_EMAIL',
        source: 'background',
        payload: { generateNew },
      });

      if (result?.error) {
        throw new Error(result.error);
      }
      if (!result?.email) {
        throw new Error('未返回 Duck 邮箱地址。');
      }

      await setEmailState(result.email);
      await addLog(`Duck 邮箱：${result.generated ? '已生成' : '已读取'} ${result.email}`, 'ok');
      return result.email;
    }

    async function fetchManagedAliasEmail(state, options = {}) {
      throwIfStopped();
      const provider = String(options.mailProvider || state?.mailProvider || '').trim().toLowerCase();
      const mergedState = {
        ...(state || {}),
        mailProvider: provider,
      };
      if (options.gmailBaseEmail !== undefined) {
        mergedState.gmailBaseEmail = String(options.gmailBaseEmail || '').trim();
      }
      if (options.mail2925BaseEmail !== undefined) {
        mergedState.mail2925BaseEmail = String(options.mail2925BaseEmail || '').trim();
      }

      const email = buildGeneratedAliasEmail(mergedState);
      await setEmailState(email);
      await addLog(`${provider === 'gmail' ? 'Gmail +tag' : '2925'}：已生成 ${email}`, 'ok');
      return email;
    }

    async function fetchGeneratedEmail(state, options = {}) {
      const currentState = state || await getState();
      const provider = String(options.mailProvider || currentState.mailProvider || '').trim().toLowerCase();
      if (isGeneratedAliasProvider?.(provider)) {
        return buildEmailResult(await fetchManagedAliasEmail(currentState, options));
      }
      const generator = normalizeEmailGenerator(options.generator ?? currentState.emailGenerator);
      if (generator === 'custom') {
        throw new Error('当前邮箱生成方式为自定义邮箱，请直接填写注册邮箱。');
      }
      if (generator === QQ_ALIAS_EMAIL_GENERATOR) {
        return fetchQqAliasEmail(currentState, options);
      }
      if (generator === 'icloud') {
        return buildEmailResult(await fetchIcloudHideMyEmail());
      }
      if (generator === 'cloudflare') {
        return buildEmailResult(await fetchCloudflareEmail(currentState, options));
      }
      if (generator === CLOUDFLARE_TEMP_EMAIL_GENERATOR) {
        return buildEmailResult(await fetchCloudflareTempEmailAddress(currentState, options));
      }
      return buildEmailResult(await fetchDuckEmail(options));
    }

    return {
      continueQqAliasFlow,
      ensureCloudflareTempEmailConfig,
      fetchCloudflareEmail,
      fetchCloudflareTempEmailAddress,
      fetchDuckEmail,
      fetchGeneratedEmail,
      generateCloudflareAliasLocalPart,
      requestCloudflareTempEmailJson,
    };
  }

  return {
    createGeneratedEmailHelpers,
  };
});
