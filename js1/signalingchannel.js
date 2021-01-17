// This class implements a signaling channel based on Firebase.
var SignalingChannel = function(config) {
    this.config_ = config;
    this.roomId_ = null;
    this.isInitiator_ = null;
    this.websocket_ = null;
    this.registered_ = false;

    // Public callbacks. Keep it sorted.
    this.onerror = null;
    this.onmessage = null;
};

SignalingChannel.prototype.register = function() {
    if (this.websocket_) {
        trace('ERROR: SignalingChannel has already opened.');
        return;
    }

    trace('Opening signaling channel.');
    // Initialize Firebase
    firebase.initializeApp(this.config_);
    this.websocket_ = firebase.database().ref();

    if (this.registered_) {
        trace('ERROR: SignalingChannel has already registered.');
        return;
    }
    if (!this.roomId_) {
        trace('ERROR: missing roomId.');
        return;
    }
    if (this.isInitiator_ == null) {
        trace('ERROR: missing initiator info.');
        return;
    }

    return this.websocket_.child(this.roomId_).child("session").once('value').then(function(childSnapshot) {
        if ((childSnapshot.val() && this.isInitiator_ && childSnapshot.val().code == 1) ||
            (!childSnapshot.val() && this.isInitiator_)) {
            this.websocket_.child(this.roomId_).remove();
            return this.websocket_.child(this.roomId_).child("session").child("code").set(2).then(function() {
                this.addListeners();
                return Promise.resolve();
            }.bind(this));
        }
        if ((childSnapshot.val() && !this.isInitiator_ && childSnapshot.val().code == 2)) {
            return this.websocket_.child(this.roomId_).child("session").child("code").set(3).then(function() {
                this.addListeners();
                return Promise.resolve();
            }.bind(this));
        }
        this.registered_ = false;
        return Promise.reject();
    }.bind(this));
};

SignalingChannel.prototype.addListeners = function() {
    if (this.registered_) {
        trace("Listeners already registered");
        return;
    }

    this.websocket_.child(this.roomId_).child("offer").on('value', function(childSnapshot, prevChildKey) {
        if (childSnapshot.val())
            this.handleIncomingMessage({ meta: "offer", msg: { "type": "offer", "sdp": childSnapshot.val().sdp } });
    }.bind(this));
    this.websocket_.child(this.roomId_).child("remotecandidate").on('value', function(childSnapshot, prevChildKey) {
        if (childSnapshot.val())
            this.handleIncomingMessage({
                meta: "remotecandidate",
                msg: {
                    sdpMLineIndex: childSnapshot.val().sdpMLineIndex,
                    candidate: childSnapshot.val().candidate,
                    sdpMid: childSnapshot.val().sdpMid
                }
            });
    }.bind(this));

    this.websocket_.child(this.roomId_).child("answer").on('value', function(childSnapshot, prevChildKey) {
        if (childSnapshot.val())
            this.handleIncomingMessage({ meta: "answer", msg: { "type": "answer", "sdp": childSnapshot.val().sdp } });
    }.bind(this));
    this.websocket_.child(this.roomId_).child("localcandidate").on('value', function(childSnapshot, prevChildKey) {
        if (childSnapshot.val())
            this.handleIncomingMessage({
                meta: "localcandidate",
                msg: {
                    sdpMLineIndex: childSnapshot.val().sdpMLineIndex,
                    candidate: childSnapshot.val().candidate,
                    sdpMid: childSnapshot.val().sdpMid
                }
            });
    }.bind(this));

    this.websocket_.child(this.roomId_).child("hangup").on('value', function(childSnapshot, prevChildKey) {
        if (childSnapshot.val())
            this.handleIncomingMessage({ meta: "hangup", msg: { type: "hangup", status: childSnapshot.val().status } });
    }.bind(this));

    this.registered_ = true;
    trace("Registering listeners");
};

SignalingChannel.prototype.removeListeners = function() {
    if (!this.registered_) {
        return;
    }
    this.websocket_.child(this.roomId_).child("offer").off();
    this.websocket_.child(this.roomId_).child("remotecandidate").off();
    this.websocket_.child(this.roomId_).child("answer").off();
    this.websocket_.child(this.roomId_).child("localcandidate").off();
    this.websocket_.child(this.roomId_).child("hangup").off();

    this.registered_ = false;
    trace("Removing listeners");
};

SignalingChannel.prototype.handleIncomingMessage = function(msg) {
    if (this.onmessage) {
        this.onmessage(msg);
    }
};

SignalingChannel.prototype.close = function() {
    if (this.registered_) {
        this.removeListeners();
    }

    if (!this.roomId_ || !this.websocket_) {
        return;
    }
    // Tell Firebase that we're done.
    return this.websocket_.child(this.roomId_).child("session").once('value').then(function(childSnapshot) {
        if (childSnapshot.val() && childSnapshot.val().code == 3) {
            return this.websocket_.child(this.roomId_).child("session").child("code").set(2).then(function() {
                return this.websocket_.child(this.roomId_).child("hangup").child("status").set(true).then(function() {
                    this.roomId_ = null;
                    this.websocket_ = null;
                    trace("Hangup changed to true");
                    return Promise.resolve();
                }.bind(this));
            }.bind(this));
        }

        return this.websocket_.child(this.roomId_).remove().then(function() {
            this.roomId_ = null;
            this.websocket_ = null;
            return Promise.resolve();
        }.bind(this));
    }.bind(this));
};

SignalingChannel.prototype.send = function(message) {
    if (!this.roomId_ || !this.websocket_) {
        trace('ERROR: SignalingChannel has not registered.');
        return;
    }

    trace("Message " + JSON.stringify(message));
    this.websocket_.child(this.roomId_).child(message.meta).set(message.msg);
};