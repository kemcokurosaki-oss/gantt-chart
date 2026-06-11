const nodemailer = require('nodemailer');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SECRET_KEY;
const GMAIL_USER    = process.env.GMAIL_USER;
const GMAIL_PASS    = process.env.GMAIL_APP_PASSWORD;
const TEST_MODE     = process.env.TEST_MODE === 'true';
const TEST_EMAIL    = 'e-kurosaki@kusakabe.com';

const FLOW_LABELS = {
  assembly:         '組立完了通知',
  test_run:         '試運転完了通知',
  simple_inspection:'簡易検査開催案内',
  inspection:       '外観検査開催案内',
  shipping:         '出荷確定通知',
};

// 承認依頼・再申請・却下・他者完了の件名用ラベル（申請系表記）
const FLOW_LABELS_REQUEST = {
  assembly: '組立完了申請',
  test_run: '試運転完了申請',
  shipping: '出荷確定申請',
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
function buildEmail(type, req, recipientName, extra = {}) {
  const pNum       = req?.project_number || '—';
  const machineName = req?.machine_name || '';
  const pStr       = machineName ? `${pNum} ${machineName}` : pNum; // "1234 機械A"
  const flow       = FLOW_LABELS[req?.flow_type]         || req?.flow_type || '—';
  const flowReq    = FLOW_LABELS_REQUEST[req?.flow_type] || flow; // 承認依頼・再申請用
  const note       = req?.note ? `\nコメント: ${req.note}` : '';
  const from       = `"工事工程 通知" <${GMAIL_USER}>`;
  const parallelNote = req?.flow_type === 'assembly'
    ? '\n\n※組立課長・部長どちらかが承認すれば完了になります。先に承認された場合、もう一方の承認は不要です。'
    : req?.flow_type === 'test_run'
    ? '\n\n※操業課長・部長どちらかが承認すれば完了になります。先に承認された場合、もう一方の承認は不要です。'
    : '';

  switch (type) {
    case 'approval_request':
      return {
        from,
        subject: `【承認依頼】${pStr}　${flowReq}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の「${flowReq}」について承認依頼が届いています。\n` +
          `承認フロー管理システムにログインして承認をお願いします。` +
          parallelNote +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'resubmit':
      return {
        from,
        subject: `【再申請】${pStr}　${flowReq}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の「${flowReq}」が修正のうえ再申請されました。\n` +
          `承認フロー管理システムにログインして内容をご確認のうえ承認をお願いします。` +
          parallelNote +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'approved':
    case 'completed': {
      const isShipping = req?.flow_type === 'shipping';
      const shippingDate = isShipping && req?.confirmed_shipping_date
        ? `\n確定出荷日: ${req.confirmed_shipping_date}` : '';
      const approverLine = isShipping && extra?.approverName
        ? `\n承認者: ${extra.approverName}（常務）` : '';
      let ownersSection = '';
      if (isShipping && extra?.owners) {
        const o = extra.owners;
        const lines = [];
        if (o.sekkei)   lines.push(`  設計: ${o.sekkei}`);
        if (o.kumitate) lines.push(`  組立: ${o.kumitate}`);
        if (o.shiunten) lines.push(`  操業: ${o.shiunten}`);
        if (o.sales)    lines.push(`  営業: ${o.sales}`);
        if (lines.length > 0) ownersSection = '\n\n担当者確認（簡易検査）:\n' + lines.join('\n');
      }
      const completedSubject = isShipping ? `【出荷確定通知】${pStr}` : `【${flow}】${pStr}`;
      const completedBody = req?.flow_type === 'assembly'
        ? `${pStr} の機械組立が完了しました。`
        : req?.flow_type === 'test_run'
        ? `${pStr} の試運転が完了しました。`
        : isShipping
        ? `${pStr} の出荷日が確定しました。`
        : `${pStr} の「${flow}」が承認されました。`;
      return {
        from,
        subject: completedSubject,
        text:
          `${recipientName} 様\n\n` +
          completedBody +
          shippingDate +
          approverLine +
          ownersSection +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    case 'completed_by_other':
      return {
        from,
        subject: `【承認完了】${pStr}　${flowReq}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の「${flowReq}」は他の承認者により承認完了になりました。\n` +
          `対応は不要です。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'rejected':
      return {
        from,
        subject: `【却下】${pStr}　${flowReq}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の「${flowReq}」が却下されました。\n` +
          `承認フロー管理システムで内容を確認し、再申請してください。` +
          `${note}\n\n※このメールは自動送信です。`,
      };

    case 'shipping_meeting_invite': {
      const date     = req?.inspection_date     || '未定';
      const time     = req?.inspection_time     ? ` ${req.inspection_time}` : '';
      const location = req?.inspection_location || '未定';
      return {
        from,
        subject: `【出荷確認会議開催案内】${pStr}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の出荷確認会議を下記のとおり実施します。\n\n` +
          `日時: ${date}${time}\n` +
          `場所: ${location}` +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    case 'simple_inspection_reschedule': {
      const date     = req?.inspection_date     || '未定';
      const time     = req?.inspection_time     ? ` ${req.inspection_time}` : '';
      const location = req?.inspection_location || '未定';
      return {
        from,
        subject: `【簡易検査 日程変更】${pStr}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の簡易検査の日程が変更されました。\n\n` +
          `日時: ${date}${time}\n` +
          `場所: ${location}` +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    case 'simple_inspection_invite': {
      const date     = req?.inspection_date     || '未定';
      const time     = req?.inspection_time     ? ` ${req.inspection_time}` : '';
      const location = req?.inspection_location || '未定';
      return {
        from,
        subject: `【簡易検査開催案内】${pStr}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の簡易検査を下記のとおり実施します。\n\n` +
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
        subject: `【外観検査開催案内】${pStr}`,
        text:
          `${recipientName} 様\n\n` +
          `${pStr} の外観検査を下記のとおり実施します。\n\n` +
          `日時: ${date}${time}\n` +
          `場所: ${location}` +
          `${note}\n\n※このメールは自動送信です。`,
      };
    }

    default:
      return {
        from,
        subject: `【工程通知】${pStr}　${flow}`,
        text:
          `${recipientName} 様\n\n${pStr} に関する通知です。` +
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
    `approval_requests?id=in.(${reqIds.join(',')})&select=id,project_number,machine_name,flow_type,status,note,inspection_date,inspection_time,inspection_location,confirmed_shipping_date`
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

  // notification_recipients の名前マップを取得（外部宛先の宛名に使用）
  const recipientEmails = [...new Set(notifications.map(n => n.recipient_email).filter(Boolean))];
  let recipientEmailNameMap = {};
  if (recipientEmails.length > 0) {
    const allRecipients = await supabaseFetch(`notification_recipients?active=eq.true&select=name,email`);
    const emailSet = new Set(recipientEmails);
    (allRecipients || []).forEach(r => {
      if (r.email && emailSet.has(r.email)) recipientEmailNameMap[r.email] = r.name;
    });
  }

  // shipping完了通知用: 承認した常務の名前 + 担当者名を取得
  const shippingApproverNameMap = {};
  const shippingOwnersMap = {};
  const shippingCompletedReqIds = [...new Set(
    notifications.filter(n => reqMap[n.request_id]?.flow_type === 'shipping' && n.notification_type === 'completed')
      .map(n => n.request_id)
  )];
  if (shippingCompletedReqIds.length > 0) {
    // 承認者名
    const steps = await supabaseFetch(
      `approval_steps?request_id=in.(${shippingCompletedReqIds.join(',')})&status=eq.approved&select=request_id,approver_id`
    );
    const approverIdSet = [...new Set((steps || []).map(s => s.approver_id).filter(Boolean))];
    if (approverIdSet.length > 0) {
      const prs = await supabaseFetch(`profiles?id=in.(${approverIdSet.join(',')})&select=id,name`);
      const nameById = Object.fromEntries((prs || []).map(p => [p.id, p.name]));
      (steps || []).forEach(s => {
        if (s.approver_id && nameById[s.approver_id]) shippingApproverNameMap[s.request_id] = nameById[s.approver_id];
      });
    }
    // 担当者名（設計・組立・操業・営業）
    const salesData = await supabaseFetch(`app_settings?key=eq.sales_person_map&select=value`);
    const salesMap = salesData?.[0]?.value ? JSON.parse(salesData[0].value) : {};
    for (const reqId of shippingCompletedReqIds) {
      const req = reqMap[reqId];
      if (!req) continue;
      const tasks = await supabaseFetch(
        `tasks?project_number=eq.${encodeURIComponent(req.project_number)}&machine=eq.${encodeURIComponent(req.machine_name || '')}&select=text,owner,major_item`
      );
      const findO = (text, major) => [...new Set((tasks || [])
        .filter(t => t.text === text && (!major || (t.major_item || '').trim() === major))
        .map(t => t.owner).filter(Boolean))].join('・') || null;
      shippingOwnersMap[reqId] = {
        sekkei:   findO('出図', '設計'),
        kumitate: findO('機械組立'),
        shiunten: findO('試運転'),
        sales:    salesMap[req.project_number] || null,
      };
    }
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
      toName      = recipientEmailNameMap[notif.recipient_email] || '担当者';
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
      const extra = {
        approverName: shippingApproverNameMap[notif.request_id],
        owners:       shippingOwnersMap[notif.request_id],
      };
      const mail = buildEmail(notif.notification_type, req, toName, extra);

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
