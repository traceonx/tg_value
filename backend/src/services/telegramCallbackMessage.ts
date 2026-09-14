import { Api } from 'telegram';

// Menu messages belong to the Bot; command handlers need the clicking user's
// identity while retaining the original chat, reply target and client methods.
export function callbackActorMessage(message: Api.Message, actorId: Api.UpdateBotCallbackQuery['userId']): Api.Message {
    if (!message) throw new Error('Telegram menu message is unavailable');
    return Object.create(message, {
        senderId: { value: actorId },
        fromId: { value: new Api.PeerUser({ userId: actorId }) },
    }) as Api.Message;
}
