import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogMailerService } from './log-mailer.service';
import { MailerService } from './mailer.service';
import { SmtpMailerService } from './smtp-mailer.service';

@Global()
@Module({})
export class MailerModule {
  static forRoot(): DynamicModule {
    return {
      module: MailerModule,
      providers: [
        {
          provide: MailerService,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const host = config.get<string>('SMTP_HOST');
            return host ? new SmtpMailerService(config) : new LogMailerService();
          },
        },
      ],
      exports: [MailerService],
    };
  }
}
