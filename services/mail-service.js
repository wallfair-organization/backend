const nodemailer = require('nodemailer');
const smtpTransport = require('nodemailer-smtp-transport');

const fs = require('fs');
const { publishEvent, notificationEvents } = require('./notification-service');
const { generate } = require('../helper');

const email_confirm = fs.readFileSync('./emails/email-confirm.html', 'utf8');
const email_evaluate = fs.readFileSync('./emails/email-evaluate.html', 'utf8');

const transporter = nodemailer.createTransport(
  smtpTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    auth: {
      user: process.env.GMAIL_USERNAME,
      pass: process.env.GMAIL_PASSWORD,
    },
  })
);

exports.sendConfirmMail = async (user) => {
  const emailCode = generate(6);
  const queryString = `?userId=${user.id}&code=${emailCode}`;
  /**
   * TODO
   * When using v2 route please don't forget to pass `email` to the new route as POST param.
   */
  const generatedTemplate = email_confirm
    .replace('{{query_string}}', queryString)
    .replace('{{verify_url}}', process.env.VERIFY_URL);

  await this.sendMail(user.email, 'Please confirm your email!', generatedTemplate);

  user.emailCode = emailCode;
  await user.save();
};

exports.sendEventEvaluateMail = async (payload) => {
  const ratings = {
    0: 'Excellent',
    1: 'Good',
    2: 'Lame',
    3: 'Unethical',
  };
  const { bet_question } = payload;
  const rating = ratings[payload.rating];
  const { comment } = payload;
  const generatedTemplate = email_evaluate
    .replace('{{bet_question}}', bet_question)
    .replace('{{rating}}', rating)
    .replace('{{comment}}', comment);
  await this.sendMail('feedback@wallfair.io', 'Event Evaluate Feedback', generatedTemplate);

  publishEvent(notificationEvents.EVENT_BET_EVALUATED, {
    producer: 'system',
    producerId: 'notification-service',
    data: {
      bet_question,
      rating,
      comment,
    },
  });
};

exports.sendMail = async (email, subject, template) => {
  try {
    const info = await transporter.sendMail({
      from: '"WALLFAIR" noreply@wallfair.io',
      to: email,
      subject,
      html: template,
    });

    console.log('email sent: %s', info.messageId);
  } catch (err) {
    console.log(err);
    console.log('email sent failed to: %s', email);
  }
};
