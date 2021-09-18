const ChatMessageService = require('./chat-message-service');
const notificationTypes = require('@wallfair.io/wallfair-commons').constants.events.notification

const LOG_TAG = '[SOCKET] ';
let pubClient = null;

const persist = async (data) => {
  if (data) {
    const chatMessage = await ChatMessageService.createChatMessage(data);
    await ChatMessageService.saveChatMessage(chatMessage);
  }
};

exports.setIO = (newIo) => (io = newIo);
exports.setPubClient = (newpub) => (pubClient = newpub);

exports.handleChatMessage = async function (socket, data, userId) {
  try {
    const responseData = { ...data, userId, date: new Date() };
    const { roomId } = data;
    const { message } = data;

    console.debug(LOG_TAG, `user ${userId} sends message "${message}" to room ${roomId}`);

    await persist(data);

    emitToAllByEventId(roomId, 'chatMessage', responseData);
  } catch (error) {
    console.error(error);
    console.log(LOG_TAG, 'failed to handle message', data);
  }
};

exports.handleJoinRoom = async function (socket, data) {
  try {
    const { roomId, userId } = data;

    if (roomId) {
      await socket.join(roomId);
    } else {
      console.debug(LOG_TAG, 'no room id in handle join data', data);
    }

    if (userId) {
      socket.join(userId);
    } else {
      console.debug(LOG_TAG, 'no user id in handle join data', data);
    }
  } catch (error) {
    console.error(error);
    console.log(LOG_TAG, 'failed to handle join room', data);
  }
};

exports.handleLeaveRoom = async function (socket, data) {
  try {
    const { roomId, userId } = data;

    if (roomId) {
      await socket.leave(roomId);
    } else {
      console.debug(LOG_TAG, 'no room id in handle leave data', data);
    }

    if (userId) {
      socket.leave(userId);
    } else {
      console.debug(LOG_TAG, 'no user id in handle leave data', data);
    }
  } catch (error) {
    console.error(error);
    console.log(LOG_TAG, 'failed to handle leave room', data);
  }
};

exports.emitPlaceBetToAllByEventId = async (eventId, betId, user, amount, outcome) => {
  const message = 'dummy';
  const betPlacedData = {
    roomId: eventId,
    betId,
    type: 'BET_PLACE',
    amount: amount.toString(),
    outcome,
    message,
    user,
    date: new Date(),
  };

  await handleBetMessage(eventId, 'betPlaced', betPlacedData);
};

exports.emitPullOutBetToAllByEventId = async (
  eventId,
  betId,
  user,
  amount,
  outcome,
  currentPrice
) => {
  const message = 'dummy';
  const betPulledOutData = {
    roomId: eventId,
    betId,
    type: 'BET_PULLOUT',
    amount: amount.toString(),
    outcome,
    currentPrice: currentPrice.toString(),
    message,
    user,
    date: new Date(),
  };

  await handleBetMessage(eventId, 'betPulledOut', betPulledOutData);
};

exports.emitBetCreatedByEventId = async (eventId, userId, betId, title) => {
  const message = 'dummy';
  const betCreationData = {
    roomId: eventId,
    betId,
    type: 'BET_CREATE',
    title,
    message,
    userId,
    date: new Date(),
  };

  await handleBetMessage(eventId, 'betCreated', betCreationData);
};

const handleBetMessage = async (eventId, emitEventName, data) => {
  // await persist(data); TODO: Check if we need to persist these types of messages
  emitToAllByEventId(eventId, emitEventName, data);
};

const emitToAllByEventId = (eventId, emitEventName, data) => {
  console.debug(LOG_TAG, `emitting event "${emitEventName}" to all in event room ${eventId}`);
  // io.of('/').to(eventId.toString()).emit(emitEventName, data);
  pubClient.publish(
    'message',
    JSON.stringify({
      to: eventId.toString(),
      event: emitEventName,
      data: { date: new Date(), ...data },
    })
  );
};

exports.emitToAllByEventId = emitToAllByEventId;

const emitEventStartNotification = (userId, eventId, eventName) => {
  console.log(userId, eventId, eventName);
  // const message = `The event ${eventName} begins in 60s. Place your token.`;
  // emitToAllByUserId(userId, 'notification', { type: notificationTypes.EVENT_START, eventId, message });
};
exports.emitEventStartNotification = emitEventStartNotification;

const emitBetResolveNotification = (
  userId,
  betId,
  betQuestion,
  betOutcome,
  amountTraded,
  eventPhotoUrl,
  tokensWon
) => {
  let message = `The bet ${betQuestion} was resolved. The outcome is ${betOutcome}. You traded ${amountTraded} WFAIR.`;
  if (tokensWon > 0) {
    message += ` You won ${tokensWon} WFAIR.`;
  }

  emitToAllByUserId(userId, 'notification', {
    type: notificationTypes.EVENT_RESOLVE,
    betId,
    message,
    betQuestion,
    betOutcome,
    amountTraded,
    eventPhotoUrl,
    tokensWon,
  });
};
exports.emitBetResolveNotification = emitBetResolveNotification;

const emitEventCancelNotification = (userId, eventId, eventName, cancellationDescription) => {
  console.log(userId, eventId, eventName, cancellationDescription);
  // const message = `The event ${eventName} was cancelled due to ${cancellationDescription}.`;
  // emitToAllByUserId(userId, 'notification', { type: notificationTypes.EVENT_CANCEL, eventId, message });
};
exports.emitEventCancelNotification = emitEventCancelNotification;

const emitEventOnline = (event) => {
  emitToAllByEventId(event.id, notificationTypes.EVENT_ONLINE, event);
};
exports.emitEventOnline = emitEventOnline;

const emitEventOffline = (event) => {
  emitToAllByEventId(event.id, notificationTypes.EVENT_OFFLINE, event);
};
exports.emitEventOffline = emitEventOffline;

const emitToAllByUserId = (userId, emitEventName, data) => {
  console.debug(LOG_TAG, `emitting event "${emitEventName}" to all in user room ${userId}`);
  // io.of('/').to(userId.toString()).emit(emitEventName, {date: new Date(), ...data});
  pubClient.publish(
    'message',
    JSON.stringify({
      to: userId.toString(),
      event: emitEventName,
      data: { date: new Date(), ...data },
    })
  );
};

const emitToSystem = (data) => {
  io.of('/').to('system').emit(data.type, ...data)
}
