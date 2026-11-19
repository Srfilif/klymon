import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { LogMailerService } from './log-mailer.service';
import { MailerModule } from './mailer.module';
import { MailerService } from './mailer.service';
import { SmtpMailerService } from './smtp-mailer.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn(async () => ({})) })),
}));

const mockedCreateTransport = createTransport as unknown as jest.Mock;

describe('MailerModule', () => {
  beforeEach(() => {
    mockedCreateTransport.mockClear();
  });

  function configWith(values: Record<string, string | undefined>) {
    const stub = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        const value = values[key];
        if (value === undefined) throw new Error(`Missing ${key}`);
        return value;
      },
    };
    @Global()
    @Module({ providers: [{ provide: ConfigService, useValue: stub }], exports: [ConfigService] })
    class ConfigStub {}
    return ConfigStub;
  }

  it('selects the log mailer without SMTP config and never touches the network', async () => {
    const module = await Test.createTestingModule({
      imports: [MailerModule.forRoot(), configWith({})],
    }).compile();
    const mailer = module.get(MailerService);
    expect(mailer).toBeInstanceOf(LogMailerService);
    expect(mockedCreateTransport).not.toHaveBeenCalled();
    await expect(mailer.send({ to: 'a@x.com', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('selects SMTP when configured and maps fields', async () => {
    const module = await Test.createTestingModule({
      imports: [
        MailerModule.forRoot(),
        configWith({
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: '587',
          SMTP_SECURE: 'false',
          SMTP_USER: 'user',
          SMTP_PASS: 'pass',
          MAIL_FROM: 'Klymon <noreply@x.com>',
        }),
      ],
    }).compile();
    const mailer = module.get(MailerService);
    expect(mailer).toBeInstanceOf(SmtpMailerService);
    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, auth: { user: 'user', pass: 'pass' } }),
    );
    await mailer.send({ to: 'a@x.com', subject: 's', text: 't' });
    const sendMail = mockedCreateTransport.mock.results[0]?.value.sendMail as jest.Mock;
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Klymon <noreply@x.com>', to: 'a@x.com' }));
  });
});
