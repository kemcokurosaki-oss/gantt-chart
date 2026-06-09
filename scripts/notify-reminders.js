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

const FLOW_LABELS  = { assembly: '組立完了通知', test_run: '試運転完了通知' };
const TASK_TO_FLOW = { '機械組立': 'assembly', '試運転': 'test_run' };

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

async function sendEmail(toEmail, toName, subject, body) {
  const actualTo = TEST_MODE ? TEST_EMAIL : toEmail;
  await transporter.sendMail({
    from:    `"工事工程 通知" <${GMAIL_USER}>`,
    to:      actualTo,
    subject: TEST_MODE ? `[TEST] ${subject}` : subject,
    text:    TEST_MODE ? `【テスト送信】本来の宛先: ${toEmail}\n\n${body}` : body,
  });
  console.log(`✓ 送信完了: ${actualTo} (${toName} / ${subject})`);
}

function tokyoDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

// ===== 承認催促 =====
async function runApprovalReminders() {
  console.log('\n--- 承認催促チェック ---');

  // 24時間以上前に申請されてまだ submitted のリクエスト（テストモードは時間制限なし）
  const cutoff = new Date(Date.now() - (TEST_MODE ? 0 : 24 * 60 * 60 * 1000)).toISOString();
  const requests = await supabaseFetch(
    `approval_requests?status=eq.submitted&flow_type=in.(assembly,test_run)` +
    `&created_at=lte.${encodeURIComponent(cutoff)}&select=id,project_number,machine_name,flow_type`
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

        const flow    = FLOW_LABELS[req.flow_type] || req.flow_type;
        const machine = req.machine_name ? `【${req.machine_name}】` : '';
        const subject = `【承認催促】工番 ${req.project_number}${machine}　${flow}`;
        const text    =
          `${approver.name} 様\n\n` +
          `工番 ${req.project_number}${machine} の「${flow}」について、` +
          `承認依頼が届いてから24時間以上が経過しています。\n` +
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
    `approval_requests?flow_type=in.(assembly,test_run)&status=neq.rejected` +
    `&select=project_number,machine_name,flow_type`
  );
  const submittedSet = new Set(
    (submitted || []).map(r => `${r.project_number}__${r.machine_name}__${r.flow_type}`)
  );

  let count = 0;
  for (const [taskText, flowType] of Object.entries(TASK_TO_FLOW)) {
    // テストモードは終了日の制限なし（未来日のタスクも対象にして動作確認）
    const dateFilter = TEST_MODE ? '' : `&end_date=lt.${todayStr}`;
    const tasks = await supabaseFetch(
      `tasks?text=eq.${encodeURIComponent(taskText)}${dateFilter}` +
      `&select=project_number,machine,owner,end_date,is_completed`
    );

    for (const task of (tasks || [])) {
      if (!task.owner || task.is_completed) continue;
      // テストモードで工事番号が指定されている場合は絞り込み
      if (TEST_MODE && TEST_PROJECT && String(task.project_number) !== TEST_PROJECT) continue;

      const key = `${task.project_number}__${task.machine}__${flowType}`;
      if (submittedSet.has(key)) continue;

      const profiles = await supabaseFetch(
        `profiles?name=eq.${encodeURIComponent(task.owner)}&select=id,name,email`
      );

      for (const profile of (profiles || [])) {
        if (!profile.email) continue;

        const flow    = FLOW_LABELS[flowType] || flowType;
        const machine = task.machine ? `【${task.machine}】` : '';
        const subject = `【申請催促】工番 ${task.project_number}${machine}　${flow}`;
        const text    =
          `${profile.name} 様\n\n` +
          `工番 ${task.project_number}${machine} の「${flow}」について、` +
          `タスクの終了日（${task.end_date}）を過ぎていますが申請がされていません。\n` +
          `承認フロー管理システムにログインして申請をお願いします。\n\n` +
          `※このメールは自動送信です。`;

        try {
          await sendEmail(profile.email, profile.name, subject, text);
          count++;
        } catch (e) {
          console.error(`✗ 送信エラー: ${profile.email}`, e.message);
        }
      }
    }
  }
  console.log(`申請催促: ${count}件送信`);
}

async function main() {
  requireEnv('SUPABASE_URL', SUPABASE_URL);
  requireEnv('SUPABASE_SECRET_KEY', SUPABASE_KEY);
  requireEnv('GMAIL_USER', GMAIL_USER);
  requireEnv('GMAIL_APP_PASSWORD', GMAIL_PASS);

  console.log('====== リマインダー通知 ======');
  console.log(`テストモード: ${TEST_MODE}`);
  console.log(`実行日 (JST): ${tokyoDateStr()}`);

  await runApprovalReminders();
  await runSubmissionReminders();

  console.log('\n====== 完了 ======');
}

main().catch(e => {
  console.error('致命的エラー:', e);
  process.exit(1);
});
