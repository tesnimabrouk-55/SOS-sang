import type { Logger } from '@sos/shared';

/**
 * TRANSPORTS SIMULES.
 *
 * Aucun e-mail ni SMS reel n'est envoye: les messages sont ecrits dans les logs
 * et persistes dans la table `notifications` (statut SENT). Le point d'extension
 * est isole ici: brancher un fournisseur reel (SMTP, Twilio) consiste a remplacer
 * `deliver` sans toucher au reste du service.
 */
export type Channel = 'EMAIL' | 'SMS' | 'WEB';

export interface OutboundMessage {
  channel: Channel;
  donorId: string;
  title: string;
  body: string;
  urgencyId?: string;
}

export interface DeliveryResult {
  ok: boolean;
  providerId: string;
  error?: string;
}

export interface ChannelTransport {
  deliver(message: OutboundMessage): Promise<DeliveryResult>;
}

export function createSimulatedTransport(logger: Logger, mode: string): ChannelTransport {
  return {
    async deliver(message: OutboundMessage): Promise<DeliveryResult> {
      // Mode "fail" permet de tester la resilience et les nouvelles tentatives.
      if (mode === 'fail') {
        return { ok: false, providerId: 'simulated', error: 'SIMULATED_FAILURE' };
      }
      logger.info(
        { channel: message.channel, donorId: message.donorId, urgencyId: message.urgencyId },
        `[SIMULE] ${message.channel} -> ${message.title}`,
      );
      return { ok: true, providerId: `simulated-${message.channel.toLowerCase()}` };
    },
  };
}
