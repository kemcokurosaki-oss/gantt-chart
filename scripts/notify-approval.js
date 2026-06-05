const nodemailer = require('nodemailer');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SECRET_KEY;
const GMAIL_USER    = process.env.GMAIL_USER;
const GMAIL_PASS    = process.env.GMAIL_APP_PASSWORD;
const TEST_MODE     = process.env.TEST_MODE === 'true';
const TEST_EMAIL    = 'e-kurosaki@kusakabe.com';

const FLOW_LABELS = {
  assembly:   '組立完了通知',
  test_run:   '試運転完了通知',
  inspection: '外観検査開催案内',
  shipping:   '出荷確認書',
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

// ===== Supabase REST API =====
async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey':          SUPABASE_KEY,
      'Authorization':   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':    'application/json',
      'Prefer':          options.method === 'PATCH' ? 'return=minimal' : 'return=representation',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error [${res.status}]: ${text}`);
  }
  if (options.method === 'PATCH') return null;
  return res.json();
}

// ===== メール本文生成 =====
function buildEmail(type, req, recipientName) {
  const pNum  = req?.project_number || '—';
  const flow  = FLOW_LABELS[req?.flow_type] || req?.flow_type || '—';
  const note  = req?.note ? `\nコメント: ${req.note}` : '';
  const from  = `"工事工程 通知" <${GMAIL_USER}>`;

  switch (type) {
    case 'approval_request':
      return {
        from,
        subject: `【承認依頼】工番 ${pNum}　${flow}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の「${flow}」について承認依頼が届いています。\n` +
          `承認フロー管理システムにログインして承認をお願いします。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'resubmit':
      return {
        from,
        subject: `【再申請】工番 ${pNum}　${flow}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の「${flow}」が修正のうえ再申請されました。\n` +
          `承認フロー管理システムにログインして内容をご確認のうえ承認をお願いします。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'approved':
    case 'completed':
      return {
        from,
        subject: `【承認完了】工番 ${pNum}　${flow}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の「${flow}」が承認されました。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'rejected':
      return {
        from,
        subject: `【却下】工番 ${pNum}　${flow}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の「${flow}」が却下されました。\n` +
          `承認フロー管理システムで内容を確認し、再申請してください。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'shipping_meeting_invite': {
      const date     = req?.inspection_date     || '未定';
      const time     = req?.inspection_time     ? ` ${req.inspection_time}` : '';
      const location = req?.inspection_location || '未定';
      return {
        from,
        subject: `【出荷確認会議開催案内】工番 ${pNum}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の出荷確認会議を下記のとおり実施します。\n\n` +
          `日時: ${date}${time}\n` +
          `場所: ${location}` +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    case 'inspection_invite': {
      const date     = req?.inspection_date     || '未定';
      const time     = req?.inspection_time     ? ` ${req.inspection_time}` : '';
      const location = req?.inspection_location || '未定';
      return {
        from,
        subject: `【外観検査開催案内】工番 ${pNum}`,
        text:
          `${recipientName} 様\n\n` +
          `工番 ${pNum} の外観検査を下記のとおり実施します。\n\n` +
          `日時: ${date}${time}\n` +
          `場所: ${location}` +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    default:
      return {
        from,
        subject: `【工程通知】工番 ${pNum}　${flow}`,
        text:
          `${recipientName} 様\n\n工番 ${pNum} に関する通知です。` +
          `${note}\n\n※このメールは自動送信です。`,
      };
  }
}

// ===== メイン処理 =====
async function main() {
  console.log(`====== 承認フロー通知 ======`);
  console.log(`テストモード: ${TEST_MODE}`);

  // 未送信の通知を取得
  const notifications = await supabaseFetch(
    'approval_notifications?emailed_at=is.null&select=id,request_id,recipient_id,recipient_email,notification_type'
  );
  console.log(`未送信通知: ${notifications.length}件`);

  if (notifications.length === 0) {
    console.log('送信する通知はありません');
    return;
  }

  // 申請レコードを一括取得
  const reqIds = [...new Set(notifications.map(n => n.request_id))];
  const requests = await supabaseFetch(
    `approval_requests?id=in.(${reqIds.join(',')})&select=id,project_number,flow_type,status,note,inspection_date,inspection_time,inspection_location,confirmed_shipping_date`
  );
  const reqMap = Object.fromEntries(requests.map(r => [r.id, r]));

  // profiles のメールアドレスを一括取得（recipient_idがある場合のみ）
  const recipientIds = [...new Set(
    notifications.map(n => n.recipient_id).filter(Boolean)
  )];
  let profileMap = {};
  if (recipientIds.length > 0) {
    const profiles = await supabaseFetch(
      `profiles?id=in.(${recipientIds.join(',')})&select=id,name,email`
    );
    profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  }

  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (const notif of notifications) {
    const req = reqMap[notif.request_id];

    // 宛先メールアドレスと名前を決定
    // recipient_email がある場合はそちらを優先（notification_recipients の外部宛先）
    let actualEmail, toName;
    if (notif.recipient_email) {
      actualEmail = notif.recipient_email;
      toName      = '担当者';
    } else if (notif.recipient_id) {
      const profile = profileMap[notif.recipient_id];
      if (!profile?.email) {
        console.log(`スキップ: recipient_id=${notif.recipient_id} (メールアドレスなし)`);
        skipCount++;
        continue;
      }
      actualEmail = profile.email;
      toName      = profile.name || '担当者';
    } else {
      console.log(`スキップ: id=${notif.id} (宛先なし)`);
      skipCount++;
      continue;
    }

    const toEmail = TEST_MODE ? TEST_EMAIL : actualEmail;

    try {
      const mail = buildEmail(notif.notification_type, req, toName);

      await transporter.sendMail({
        from:    mail.from,
        to:      toEmail,
        subject: TEST_MODE ? `[TEST] ${mail.subject}` : mail.subject,
        text:    TEST_MODE
          ? `【テスト送信】本来の宛先: ${actualEmail}\n\n${mail.text}`
          : mail.text,
      });

      console.log(`✓ 送信完了: ${toEmail} (${notif.notification_type} / 工番${req?.project_number})`);

      // 送信済みマーク
      await supabaseFetch(`approval_notifications?id=eq.${notif.id}`, {
        method:  'PATCH',
        body:    JSON.stringify({ emailed_at: new Date().toISOString() }),
      });

      successCount++;
    } catch (err) {
      console.error(`✗ 送信エラー: ${toEmail}`, err.message);
      errorCount++;
    }
  }

  console.log(`\n====== 完了 ======`);
  console.log(`送信成功: ${successCount}件 / スキップ: ${skipCount}件 / エラー: ${errorCount}件`);
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
