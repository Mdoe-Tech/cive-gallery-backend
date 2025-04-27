// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // --- Enable CORS ---
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  logger.log(`Enabling CORS for origin: ${frontendUrl}`);
  app.enableCors({
    origin: frontendUrl,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  // --- End CORS ---

  // --- Set Global Prefix ---
  const globalPrefix = 'api/v1/cive-gallery';
  app.setGlobalPrefix(globalPrefix);
  logger.log(`Global prefix set to '/${globalPrefix}'`);
  // --- End Global Prefix ---

  // --- Global Pipes ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // forbidNonWhitelisted: true, // Optional: Throw error if extra properties are sent
    }),
  );
  logger.log('Global ValidationPipe configured.');

  // --- Static Assets ---
  const staticAssetsPath = join(__dirname, '..', 'uploads');
  const staticAssetsPrefix = '/uploads/';
  app.useStaticAssets(staticAssetsPath, {
    prefix: staticAssetsPrefix,
  });
  logger.log(`Serving static assets from '${staticAssetsPath}' at '${staticAssetsPrefix}'`);

  // --- Use WebSocket Adapter ---
  app.useWebSocketAdapter(new IoAdapter(app));
  logger.log('WebSocket IoAdapter configured.');

  // --- Start Listening ---
  const port = configService.get<number>('PORT', 5050);
  await app.listen(port);

  // --- Log Final Information ---
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`Access static files at: ${await app.getUrl()}${staticAssetsPrefix.substring(1)}`);
  logger.log(`Environment: ${configService.get<string>('NODE_ENV', 'development')}`);
  logger.log(`Redis cache enabled at: ${configService.get<string>('REDIS_URL', 'redis://localhost:6379')}`);
}

bootstrap();
