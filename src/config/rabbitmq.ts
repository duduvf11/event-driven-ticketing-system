import amqp, { Channel, ChannelModel } from 'amqplib';

export const RABBITMQ_CONFIG = {
  url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  reservationTtlMs: Number(process.env.RESERVATION_TTL_MS) || 30000,
};

class RabbitMQConnection {
  private static instance: RabbitMQConnection;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  private constructor() {}

  public static getInstance(): RabbitMQConnection {
    if (!RabbitMQConnection.instance) {
      RabbitMQConnection.instance = new RabbitMQConnection();
    }
    return RabbitMQConnection.instance;
  }

  public async connect(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    try {
      this.connection = await amqp.connect(RABBITMQ_CONFIG.url);
      this.channel = await this.connection.createChannel();

      console.log('Conectado ao RabbitMQ com sucesso!');

      this.connection.on('error', (err) => {
        console.error('Erro na conexão com RabbitMQ:', err);
      });

      this.connection.on('close', () => {
        console.warn('Conexão com RabbitMQ encerrada.');
        this.channel = null;
        this.connection = null;
      });

      return this.channel;
    } catch (error) {
      console.error('Falha ao conectar ao RabbitMQ.', error);
      throw error;
    }
  }

  public async getChannel(): Promise<Channel> {
    if (!this.channel) {
      return this.connect();
    }
    return this.channel;
  }

  public async close(): Promise<void> {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}

export const rabbitMQ = RabbitMQConnection.getInstance();