export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** Delivery contract. Log (dev) or SMTP (prod) — selected by MailerModule. */
export abstract class MailerService {
  abstract send(mail: OutgoingMail): Promise<void>;
}
