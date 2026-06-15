/**
 * リマインダー通知
 * 1. 承認催促: 申請後24時間以上承認されていない場合、承認者に毎日通知
 * 2. 申請催促: タスク終了日を過ぎても申請がない場合、担当者に毎日通知
 *
 * Secrets: SUPABASE_URL, SUPABASE_SECRET_KEY, GMAIL_USER, GMAIL_APP_PASSWORD
 */

const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD;
const TEST_MODE    = process.env.TEST_MODE === 'true';
const TEST_EMAIL   = 'e-kurosaki@kusakabe.com';
const TEST_PROJECT = (process.env.TEST_PROJECT || '').trim();

const FLOW_LABELS = {
  assembly: '組立完了申請',
  test_run: '試運転完了申請',
  shipping: '出荷確定申請',
};
const TASK_TO_FLOW = {
  '機械組立': 'assembly',
  '試運転':   'test_run',
  '工場出荷': 'shipping',
};

function requireEnv(name, v) {
  if (!v) throw new Error(`環境変数 ${name} が未設定です`);
}

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase error [${res.status}]: ${await res.text()}`);
  return res.json();
}

async function supabaseInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase insert error [${res.status}]: ${await res.text()}`);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// 完了済み工番セット（main()でロード）
let completedProjectsSet = new Set();

async function loadCompletedProjects() {
  const rows = await supabaseFetch('completed_projects?select=project_number');
  completedProjectsSet = new Set((rows || []).map(r => String(r.project_number).trim()));
  console.log(`完了済み工番: ${completedProjectsSet.size}件を除外対象にロード`);
}

async function sendEmail(toEmail, toName, subject, body, ccEmails = []) {
  const actualTo = TEST_MODE ? TEST_EMAIL : toEmail;
  const actualCc = TEST_MODE ? [] : ccEmails.filter(Boolean);
  const mailOptions = {
    from:    `"工事工程 通知" <${GMAIL_USER}>`,
    to:      actualTo,
    subject: TEST_MODE ? `[TEST] ${subject}` : subject,
    text:    TEST_MODE
      ? `【テスト送信】本来の宛先: ${toEmail}${ccEmails.length ? '\nCC: ' + ccEmails.join(', ') : ''}\n\n${body}`
      : body,
  };
  if (actualCc.length > 0) mailOptions.cc = actualCc.join(',');
  await transporter.sendMail(mailOptions);
  const ccLog = actualCc.length ? ` CC: ${actualCc.join(', ')}` : '';
  console.log(`✓ 送信完了: ${actualTo} (${toName} / ${subject})${ccLog}`);
}

function tokyoDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

// JST翌日の日付文字列（YYYY-MM-DD）
function tomorrowJSTStr() {
  const [y, m, d] = tokyoDateStr().split('-').map(Number);
  return new Date(y, m - 1, d + 1).toLocaleDateString('en-CA');
}

// JST当日0:00のISO文字列（前日中の申請をすべて対象にするcutoff用）
function todayMidnightJST() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  return new Date(`${todayStr}T00:00:00+09:00`).toISOString();
}

// ===== 承認催促 =====
async function runApprovalReminders() {
  console.log('\n--- 承認催促チェック ---');

  // 前日以前に申請されてまだ submitted のリクエスト（テストモードは時間制限なし）
  const cutoff = TEST_MODE ? new Date().toISOString() : todayMidnightJST();
  const requests = await supabaseFetch(
    `approval_requests?status=eq.submitted&flow_type=in.(assembly,test_run,shipping)` +
    `&created_at=lt.${encodeURIComponent(cutoff)}&select=id,project_number,machine_name,flow_type`
  );

  if (!requests || requests.length === 0) {
    console.log('承認催促: 対象なし');
    return;
  }

  // 今日すでに送ったリマインダーのセット
  const todayStr = tokyoDateStr();
  const sentToday = await supabaseFetch(
    `approval_notifications?notification_type=eq.approval_reminder` +
    `&emailed_at=gte.${todayStr}&select=request_id,recipient_id`
  );
  const sentSet = new Set((sentToday || []).map(n => `${n.request_id}__${n.recipient_id}`));

  let count = 0;
  for (const req of requests) {
    if (completedProjectsSet.has(String(req.project_number).trim())) continue;
    const steps = await supabaseFetch(
      `approval_steps?request_id=eq.${req.id}&status=eq.pending&select=approver_role`
    );

    for (const step of (steps || [])) {
      const approvers = await supabaseFetch(
        `profiles?role=eq.${step.approver_role}&select=id,name,email`
      );

      for (const approver of (approvers || [])) {
        if (!approver.email) continue;
        const key = `${req.id}__${approver.id}`;
        if (sentSet.has(key)) continue;

        const flow  = FLOW_LABELS[req.flow_type] || req.flow_type;
        const pStr  = req.machine_name ? `${req.project_number} ${req.machine_name}` : String(req.project_number);
        const subject = `【承認催促】${pStr}　${flow}`;
        const text    =
          `${approver.name} 様\n\n` +
          `${pStr} の「${flow}」について、` +
          `前日に承認依頼が届いていますが、まだ承認されていません。\n` +
          `承認フロー管理システムにログインして承認をお願いします。\n\n` +
          `※このメールは自動送信です。`;

        try {
          await sendEmail(approver.email, approver.name, subject, text);
          await supabaseInsert('approval_notifications', {
            request_id:        req.id,
            recipient_id:      approver.id,
            notification_type: 'approval_reminder',
            emailed_at:        new Date().toISOString(),
          });
          sentSet.add(key);
          count++;
        } catch (e) {
          console.error(`✗ 送信エラー: ${approver.email}`, e.message);
        }
      }
    }
  }
  console.log(`承認催促: ${count}件送信`);
}

// ===== 申請催促 =====
async function runSubmissionReminders() {
  console.log('\n--- 申請催促チェック ---');

  const todayStr = tokyoDateStr();

  // 申請済みリクエストのセット（rejected以外）
  const submitted = await supabaseFetch(
    `approval_requests?flow_type=in.(assembly,test_run,shipping)&status=neq.rejected` +
    `&select=project_number,machine_name,flow_type`
  );
  const submittedSet = new Set(
    (submitted || []).map(r => `${r.project_number}__${r.machine_name}__${r.flow_type}`)
  );

  // 出荷確定申請の催促宛先（品証・製管スタッフ）をあらかじめ取得
  let shippingRecipients = null;
  async function getShippingRecipients() {
    if (shippingRecipients) return shippingRecipients;
    const qualityProfs = await supabaseFetch(`profiles?role=eq.quality&select=id,name,email`);
    const seikanProfs  = await supabaseFetch(
      `profiles?department=eq.${encodeURIComponent('製管')}&role=eq.staff&select=id,name,email`
    );
    const seen = new Set();
    shippingRecipients = [...(qualityProfs || []), ...(seikanProfs || [])].filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    return shippingRecipients;
  }

  // 申請催促CCに含める上長（組立: 課長・部長 / 操業: 課長・部長）
  const superiorCache = {};
  async function getSuperiors(flowType) {
    if (superiorCache[flowType]) return superiorCache[flowType];
    const roleMap = {
      assembly: 'assembly_manager,assembly_director',
      test_run: 'operations_manager,operations_director',
    };
    const roles = roleMap[flowType];
    if (!roles) return (superiorCache[flowType] = []);
    const profs = await supabaseFetch(
      `profiles?role=in.(${encodeURIComponent(roles)})&select=id,name,email`
    );
    superiorCache[flowType] = (profs || []).filter(p => p.email);
    return superiorCache[flowType];
  }

  const tomorrowStr = tomorrowJSTStr();

  // 今回の実行で送信済みの (タスクキー + 宛先ID) を記録（1実行内の重複防止）
  const sentThisRun = new Set();

  let count = 0;
  for (const [taskText, flowType] of Object.entries(TASK_TO_FLOW)) {
    // shipping は工場出荷の前日から通知、それ以外は終了日超過後に通知
    const endDateFilter = flowType === 'shipping'
      ? `end_date=lte.${tomorrowStr}`  // 前日以降（前日・当日・超過後も継続）
      : `end_date=lt.${todayStr}`;      // 終了日超過後
    const tasks = await supabaseFetch(
      `tasks?text=eq.${encodeURIComponent(taskText)}&${endDateFilter}` +
      `&select=project_number,machine,owner,end_date,is_completed`
    );

    for (const task of (tasks || [])) {
      if (task.is_completed) continue;
      if (completedProjectsSet.has(String(task.project_number).trim())) continue;
      // assembly/test_run はタスクオーナーが必須、shipping は不問
      if (flowType !== 'shipping' && !task.owner) continue;
      // テストモードで工事番号が指定されている場合は絞り込み
      if (TEST_MODE && TEST_PROJECT && String(task.project_number) !== TEST_PROJECT) continue;

      const key = `${task.project_number}__${task.machine}__${flowType}`;
      if (submittedSet.has(key)) continue;

      // 宛先を決定: shipping は品証・製管スタッフ、それ以外はタスクオーナー
      let recipients;
      let ccProfiles = [];
      if (flowType === 'shipping') {
        recipients = await getShippingRecipients();
      } else {
        recipients = await supabaseFetch(
          `profiles?name=eq.${encodeURIComponent(task.owner)}&select=id,name,email`
        );
        ccProfiles = await getSuperiors(flowType);
      }

      for (const profile of (recipients || [])) {
        if (!profile.email) continue;
        const dedupKey = `${task.project_number}__${task.machine || ''}__${flowType}__${profile.id}`;
        if (sentThisRun.has(dedupKey)) continue;

        const flow    = FLOW_LABELS[flowType] || flowType;
        const pStr    = task.machine ? `${task.project_number} ${task.machine}` : String(task.project_number);
        const subject = `【申請催促】${pStr}　${flow}`;
        const bodyDetail = flowType === 'shipping'
          ? `${task.end_date} が予定出荷日ですが、申請がされていません。`
          : `タスクの終了日（${task.end_date}）を過ぎていますが申請がされていません。`;
        const text    =
          `${profile.name} 様\n\n` +
          `${pStr} の「${flow}」について、` +
          `${bodyDetail}\n` +
          `承認フロー管理システムにログインして申請をお願いします。\n\n` +
          `※このメールは自動送信です。`;

        // 担当者本人と重複しないようCCから除外
        const ccEmails = ccProfiles
          .filter(p => p.id !== profile.id)
          .map(p => p.email);

        try {
          await sendEmail(profile.email, profile.name, subject, text, ccEmails);
          sentThisRun.add(dedupKey);
          count++;
        } catch (e) {
          console.error(`✗ 送信エラー: ${profile.email}`, e.message);
        }
      }
    }
  }
  console.log(`申請催促: ${count}件送信`);
}

// ===== 案内催促 =====
async function runInvitationReminders() {
  console.log('\n--- 案内催促チェック ---');

  const todayStr = tokyoDateStr();
  const [y, m, d] = todayStr.split('-').map(Number);
  const threeDaysLater = new Date(y, m - 1, d + 3).toLocaleDateString('en-CA');

  // 簡易検査申請済みの (工番__機械) セット（rejected以外）
  const submitted = await supabaseFetch(
    `approval_requests?flow_type=eq.simple_inspection&status=neq.rejected` +
    `&select=project_number,machine_name`
  );
  const submittedSet = new Set(
    (submitted || []).map(r => `${r.project_number}__${r.machine_name}`)
  );

  // 品証・製管スタッフを取得
  const qualityProfs = await supabaseFetch(`profiles?role=eq.quality&select=id,name,email`);
  const seikanProfs  = await supabaseFetch(
    `profiles?department=eq.${encodeURIComponent('製管')}&role=eq.staff&select=id,name,email`
  );
  const seenIds = new Set();
  const recipients = [...(qualityProfs || []), ...(seikanProfs || [])].filter(p => {
    if (!p.id || seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  // 試運転タスク（全件）- どの工番に試運転があるか確認 + 3日前以内の判定に使用
  const allTestRuns = await supabaseFetch(
    `tasks?text=eq.${encodeURIComponent('試運転')}&select=project_number,machine,end_date,is_completed`
  );
  const testRunMap = new Map(); // key: "工番__機械" → task
  for (const t of (allTestRuns || [])) {
    testRunMap.set(`${t.project_number}__${t.machine}`, t);
  }

  // 機械組立タスク（終了3日前以内）
  const assemblyTasks = await supabaseFetch(
    `tasks?text=eq.${encodeURIComponent('機械組立')}&end_date=lte.${threeDaysLater}` +
    `&select=project_number,machine,end_date,is_completed`
  );

  // 通知対象リストを構築
  // - 試運転あり → 試運転終了3日前にトリガー（機械組立のタイミングは使わない）
  // - 試運転なし → 機械組立終了3日前にトリガー
  const targets = [];
  const processedKeys = new Set();

  // 試運転が3日前以内のものを先に追加
  for (const [key, t] of testRunMap) {
    if (t.is_completed) continue;
    if (t.end_date > threeDaysLater) continue;
    processedKeys.add(key);
    targets.push({ project_number: t.project_number, machine: t.machine, refTaskName: '試運転', refEndDate: t.end_date });
  }

  // 試運転のない機械組立タスク（3日前以内）を追加
  for (const t of (assemblyTasks || [])) {
    if (t.is_completed) continue;
    const key = `${t.project_number}__${t.machine}`;
    if (processedKeys.has(key)) continue;
    if (testRunMap.has(key)) continue; // 試運転あり → 試運転のタイミングで通知
    processedKeys.add(key);
    targets.push({ project_number: t.project_number, machine: t.machine, refTaskName: '機械組立', refEndDate: t.end_date });
  }

  const sentThisRun = new Set();
  let count = 0;

  for (const target of targets) {
    if (completedProjectsSet.has(String(target.project_number).trim())) continue;
    if (TEST_MODE && TEST_PROJECT && String(target.project_number) !== TEST_PROJECT) continue;

    const taskKey = `${target.project_number}__${target.machine}`;
    if (submittedSet.has(taskKey)) continue;

    const pStr = target.machine ? `${target.project_number} ${target.machine}` : String(target.project_number);
    const subject = `【案内催促】${pStr}　簡易検査開催案内`;

    for (const profile of recipients) {
      if (!profile.email) continue;
      const dedupKey = `${taskKey}__simple_inspection__${profile.id}`;
      if (sentThisRun.has(dedupKey)) continue;

      const text =
        `${profile.name} 様\n\n` +
        `${pStr} について、${target.refTaskName}が ${target.refEndDate} に終了予定ですが、` +
        `簡易検査開催案内がされていません。\n` +
        `承認フロー管理システムにログインして開催案内の送付をお願いします。\n\n` +
        `※このメールは自動送信です。`;

      try {
        await sendEmail(profile.email, profile.name, subject, text);
        sentThisRun.add(dedupKey);
        count++;
      } catch (e) {
        console.error(`✗ 送信エラー: ${profile.email}`, e.message);
      }
    }
  }
  console.log(`案内催促: ${count}件送信`);
}

async function main() {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SECRET_KEY', SUPABASE_KEY);
  requireEnv('GMAIL_USER', GMAIL_USER);
  requireEnv('GMAIL_APP_PASSWORD', GMAIL_PASS);

  console.log('====== リマインダー通知 ======');
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`実行日 (JST): ${tokyoDateStr()}`);

  await loadCompletedProjects();
  await runApprovalReminders();
  await runSubmissionReminders();
  await runInvitationReminders();

  console.log('\n====== 完了 ======');
}

main().catch(e => {
  console.error('致命的エラー:', e);
  process.exit(1);
});
