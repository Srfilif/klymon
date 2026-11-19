import { Injectable, Logger } from '@nestjs/common';
import { MailerService, type OutgoingMail } from './mailer.service';

/** Development mailer: logs instead of sending (tokens never leave the machine). */
@Injectable()
export class LogMailerService extends MailerService {
  private readonly logger = new Logger(LogMailerService.name);

  async send(mail: OutgoingMail): Promise<void> {
    this.logger.log(`MAIL to=${mail.to} subject=${JSON.stringify(mail.subject)} text=${JSON.stringify(mail.text)}`);
  }
}
