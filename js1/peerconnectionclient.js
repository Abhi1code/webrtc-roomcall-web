var PeerConnectionClient = function(params) {
    this.params_ = params;

    trace('Creating RTCPeerConnnection with:\n' +
        '  config: \'' + JSON.stringify(params.configuration) + '\';\n' +
        '  constraints: \'' + JSON.stringify(params.peerConnectionConstraints) +
        '\'.');

    // Create an RTCPeerConnection via the polyfill (adapter.js).
    this.pc_ = new RTCPeerConnection(
        params.configuration, params.peerConnectionConstraints);
    this.pc_.onicecandidate = this.onIceCandidate_.bind(this);
    this.pc_.ontrack = this.onRemoteStreamAdded_.bind(this);
    this.pc_.onremovestream = trace('Remote stream removed.');
    this.pc_.onsignalingstatechange = this.onSignalingStateChanged_.bind(this);
    this.pc_.oniceconnectionstatechange = this.onIceConnectionStateChanged_.bind(this);
    this.pc_.ondatachannel = this.onDataChannelCreated_.bind(this);

    // DataChannel 
    this.dataChannel_ = this.pc_.createDataChannel("datachannel", params.dataChannelOptions);
    this.dataChannel_.onopen = this.onDataChannelOpen_.bind(this);
    this.dataChannel_.onclose = this.onDataChannelClose_.bind(this);
    this.dataChannel_.onmessage = this.onDataChannelMessage_.bind(this);

    this.hasRemoteSdp_ = false;
    this.messageQueue_ = [];
    this.isInitiator_ = false;
    this.started_ = false;

    // TODO(jiayl): Replace callbacks with events.
    // Public callbacks. Keep it sorted.
    this.onerror = null;
    this.oniceconnectionstatechange = null;
    this.onnewicecandidate = null;
    this.onremotehangup = null;
    this.onremotesdpset = null;
    this.onremotestreamadded = null;
    this.onsignalingmessage = null;
    this.onsignalingstatechange = null;

    this.ondatachannelOpen = null;
    this.ondatachannelClose = null;
    this.ondatachannelMsg = null;
};

// Set up audio and video regardless of what devices are present.
// Disable comfort noise for maximum audio quality.
PeerConnectionClient.DEFAULT_SDP_OFFER_OPTIONS_ = {
    offerToReceiveAudio: 1,
    offerToReceiveVideo: 1,
    voiceActivityDetection: false
};

PeerConnectionClient.prototype.addStream = function(stream) {
    if (!this.pc_) {
        return;
    }
    this.pc_.addStream(stream);
};

PeerConnectionClient.prototype.startAsCaller = function(offerOptions) {
    if (!this.pc_) {
        return false;
    }

    if (this.started_) {
        return false;
    }

    this.isInitiator_ = true;
    this.started_ = true;
    return true;
};

PeerConnectionClient.prototype.startAsCallee = function() {
    if (!this.pc_) {
        return false;
    }

    if (this.started_) {
        return false;
    }

    this.isInitiator_ = false;
    this.started_ = true;

    var constraints = PeerConnectionClient.DEFAULT_SDP_OFFER_OPTIONS_;
    trace('Sending offer to peer, with constraints: \n\'' +
        JSON.stringify(constraints) + '\'.');

    this.pc_.createOffer(constraints)
        .then(this.setLocalSdpAndNotify_.bind(this))
        .catch(this.onError_.bind(this, 'createOffer'));
    return true;
};

PeerConnectionClient.prototype.setLocalSdpAndNotify_ =
    function(sessionDescription) {
        this.pc_.setLocalDescription(sessionDescription)
            .then(trace.bind(null, 'Set session description success.'))
            .catch(this.onError_.bind(this, 'setLocalDescription'));

        if (this.onsignalingmessage) {
            // Chrome version of RTCSessionDescription can't be serialized directly
            // because it JSON.stringify won't include attributes which are on the
            // object's prototype chain. By creating the message to serialize
            // explicitly we can avoid the issue.
            var temp = (this.isInitiator_) ? "answer" : "offer";
            this.onsignalingmessage({ meta: temp, msg: { sdp: sessionDescription.sdp } });
        }
    };

PeerConnectionClient.prototype.onIceCandidate_ = function(event) {
    if (event.candidate) {
        var cand = (this.isInitiator_) ? "remotecandidate" : "localcandidate";
        var message = {
            meta: cand,
            msg: {
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid,
                candidate: event.candidate.candidate
            }
        };
        if (this.onsignalingmessage) {
            this.onsignalingmessage(message);
        }
    } else {
        trace('End of candidates.');
    }
};

PeerConnectionClient.prototype.onRemoteStreamAdded_ = function(event) {
    if (this.onremotestreamadded) {
        this.onremotestreamadded(event.streams[0]);
    }
};

PeerConnectionClient.prototype.onSignalingStateChanged_ = function() {
    if (!this.pc_) {
        return;
    }
    trace('Signaling state changed to: ' + this.pc_.signalingState);

    if (this.onsignalingstatechange) {
        this.onsignalingstatechange();
    }
};

PeerConnectionClient.prototype.onIceConnectionStateChanged_ = function() {
    if (!this.pc_) {
        return;
    }
    trace('ICE connection state changed to: ' + this.pc_.iceConnectionState);
    if (this.pc_.iceConnectionState === 'completed') {

    }

    if (this.oniceconnectionstatechange) {
        this.oniceconnectionstatechange();
    }
};

PeerConnectionClient.prototype.receiveSignalingMessage = function(message) {
    trace("Incoming message " + JSON.stringify(message));
    if (!message) {
        return;
    }
    if ((this.isInitiator_ && (message.meta == "answer" || message.meta == "remotecandidate")) ||
        (!this.isInitiator_ && (message.meta == "offer" || message.meta == "localcandidate"))) {
        return;
    }
    if (this.isInitiator_ && message.meta === 'offer') {
        this.hasRemoteSdp_ = true;
        this.setRemoteSdp_(message.msg);
        this.doAnswer_();
    } else if (!this.isInitiator_ && message.meta === 'answer') {
        this.hasRemoteSdp_ = true;
        this.setRemoteSdp_(message.msg);
    } else if (message.meta === 'localcandidate' || message.meta === 'remotecandidate') {
        this.pc_.addIceCandidate(message.msg)
            .then(trace('Remote candidate added successfully.'))
            .catch(this.onError_.bind(this, 'addIceCandidate'));
    } else if (message.meta === "hangup" && message.msg.status === true) {
        if (this.onremotehangup) {
            this.onremotehangup();
        }
    } else {
        trace('WARNING: unexpected message: ' + JSON.stringify(message));
    }
};

PeerConnectionClient.prototype.setRemoteSdp_ = function(message) {
    this.pc_.setRemoteDescription(new RTCSessionDescription(message))
        .then(function() {
            trace('Set remote session description success.');
            var remoteStreams = this.pc_.getRemoteStreams();
            if (this.onremotesdpset) {
                this.onremotesdpset(remoteStreams.length > 0 &&
                    remoteStreams[0].getVideoTracks().length > 0);
            }
        }.bind(this)).catch(this.onError_.bind(this, 'setRemoteDescription'));
};

PeerConnectionClient.prototype.doAnswer_ = function() {
    trace('Sending answer to peer.');
    this.pc_.createAnswer()
        .then(this.setLocalSdpAndNotify_.bind(this))
        .catch(this.onError_.bind(this, 'createAnswer'));
};

PeerConnectionClient.prototype.close = function() {
    if (!this.pc_) {
        return;
    }

    this.pc_.close();
    this.pc_ = null;
};

PeerConnectionClient.prototype.onError_ = function(tag, error) {
    trace(tag + ': ' + error.toString());
    if (this.onerror) {
        this.onerror(tag + ': ' + error.toString());
    }
};

PeerConnectionClient.prototype.onDataChannelOpen_ = function() {
    if (!this.dataChannel_) {
        return;
    }
    trace('Data channel opened');

    if (this.ondatachannelOpen) {
        this.ondatachannelOpen();
    }
};

PeerConnectionClient.prototype.onDataChannelClose_ = function() {
    if (!this.dataChannel_) {
        return;
    }
    trace('Data channel closed');

    if (this.ondatachannelClose) {
        this.ondatachannelClose();
    }
};

PeerConnectionClient.prototype.onDataChannelMessage_ = function(event) {
    if (!this.dataChannel_) {
        return;
    }
    trace('Data channel msg received ' + event.data);

    if (this.ondatachannelMsg) {
        this.ondatachannelMsg(event.data);
    }
};

PeerConnectionClient.prototype.sendMessage_ = function(msg) {
    if (!this.dataChannel_) {
        return;
    }
    trace('Sending message ' + msg);
    this.dataChannel_.send(msg);
};

PeerConnectionClient.prototype.onDataChannelCreated_ = function(event) {
    this.dataChannel_ = event.channel;
    this.dataChannel_.onopen = this.onDataChannelOpen_.bind(this);
    this.dataChannel_.onclose = this.onDataChannelClose_.bind(this);
    this.dataChannel_.onmessage = this.onDataChannelMessage_.bind(this);
};