var Call = function(params) {
    this.params_ = params;

    this.pcClient_ = null;
    this.localStream_ = null;
    this.errorMessageQueue_ = [];
    this.startTime = null;

    // Public callbacks. Keep it sorted.
    this.oncallerstarted = null;
    this.onerror = null;
    this.oniceconnectionstatechange = null;
    this.onlocalstreamadded = null;
    this.onnewicecandidate = null;
    this.onremotehangup = null;
    this.onremotesdpset = null;
    this.onremotestreamadded = null;
    this.onsignalingstatechange = null;
    this.onturnstatusmessage = null;
    this.onRoomFull = null;

    this.getMediaPromise_ = null;
    this.getIceServersPromise_ = null;

    this.ondatachannelOpen = null;
    this.ondatachannelClose = null;
    this.ondatachannelMsg = null;

    this.channel_ = new SignalingChannel(params.firebaseConfig);

};

Call.prototype.start = function(roomId, isInitiator) {
    this.connectToRoom_(roomId, isInitiator);
};

Call.prototype.onRecvSignalingChannelMessage_ = function(msg) {
    this.createPcClient_()
        .then(this.pcClient_.receiveSignalingMessage(msg));
};

Call.prototype.createPcClient_ = function() {
    return new Promise(function(resolve, reject) {
        if (this.pcClient_) {
            trace('PeerConnectionClient already exists');
            resolve();
            return;
        }
        this.pcClient_ = new PeerConnectionClient(this.params_);
        this.pcClient_.onsignalingmessage = this.sendSignalingMessage_.bind(this);
        this.pcClient_.onremotehangup = this.onremotehangup;
        this.pcClient_.onremotesdpset = this.onremotesdpset;
        this.pcClient_.onremotestreamadded = this.onremotestreamadded;
        this.pcClient_.onsignalingstatechange = this.onsignalingstatechange;
        this.pcClient_.oniceconnectionstatechange = this.oniceconnectionstatechange;
        this.pcClient_.onnewicecandidate = this.onnewicecandidate;
        this.pcClient_.onerror = this.onerror;

        this.pcClient_.ondatachannelOpen = this.ondatachannelOpen;
        this.pcClient_.ondatachannelClose = this.ondatachannelClose;
        this.pcClient_.ondatachannelMsg = this.ondatachannelMsg;
        trace('Created PeerConnectionClient');
        resolve();
    }.bind(this));
};

Call.prototype.connectToRoom_ = function(roomId, isInitiator) {
    this.params_.roomId = roomId;
    this.params_.isInitiator = isInitiator;

    this.channel_.isInitiator_ = this.params_.isInitiator;
    this.channel_.roomId_ = this.params_.roomId;

    this.channel_.register().then(function(res) {
        var getPath = this.params_.roomServer + '/?id=' + this.params_.roomId;
        //window.location.assign(getPath);
        window.history.replaceState({ id: "100" },
            "Fresh", getPath);

        this.channel_.onmessage = this.onRecvSignalingChannelMessage_.bind(this);

        this.maybeGetMedia_().then(function(res) {
            // start signalling
            this.startSignaling_();
        }.bind(this)).catch(function(error) {
            // Media access error
        }.bind(this));
    }.bind(this)).catch(function(error) {
        // Show ui to the user
        if (this.onRoomFull) {
            this.onRoomFull();
        }
    }.bind(this));
};

// Asynchronously request user media if needed.
Call.prototype.maybeGetMedia_ = function() {

    var needStream = (this.params_.mediaConstraints.audio !== false ||
        this.params_.mediaConstraints.video !== false);
    var mediaPromise = null;
    if (needStream) {
        var mediaConstraints = this.params_.mediaConstraints;

        mediaPromise = navigator.mediaDevices.getUserMedia(mediaConstraints)
            .then(function(stream) {
                trace('Got access to local media with mediaConstraints:\n' +
                    '  \'' + JSON.stringify(mediaConstraints) + '\'');

                this.onUserMediaSuccess_(stream);
                return Promise.resolve();
            }.bind(this)).catch(function(error) {
                this.onError_('Error getting user media: ' + error.message);
                this.onUserMediaError_(error);
                return Promise.reject();
            }.bind(this));
    } else {
        mediaPromise = Promise.resolve();
    }
    return mediaPromise;
};

Call.prototype.onUserMediaSuccess_ = function(stream) {
    this.localStream_ = stream;
    if (this.onlocalstreamadded) {
        this.onlocalstreamadded(stream);
    }
};

Call.prototype.onUserMediaError_ = function(error) {
    var errorMessage = 'Failed to get access to local media. Error name was ' +
        error.name + '. Continuing without sending a stream.';
    this.onError_('getUserMedia error: ' + errorMessage);
    alert(errorMessage);
};

Call.prototype.sendSignalingMessage_ = function(message) {
    this.channel_.send(message);
};

Call.prototype.sendDataChannelMsg_ = function(msg) {
    if (!this.pcClient_) {
        return;
    }
    this.pcClient_.sendMessage_(msg);
};

Call.prototype.hangup = function() {
    if (this.localStream_) {
        if (typeof this.localStream_.getTracks === 'undefined') {
            // Support legacy browsers, like phantomJs we use to run tests.
            this.localStream_.stop();
        } else {
            this.localStream_.getTracks().forEach(function(track) {
                track.stop();
            });
        }
        this.localStream_ = null;
    }

    if (!this.params_.roomId) {
        return;
    }

    if (this.pcClient_) {
        this.pcClient_.close();
        this.pcClient_ = null;
    }

    if (this.channel_) {
        return this.channel_.close().then(function() {
            trace('Cleanup completed.');
            return Promise.resolve();
        }).catch(() => {
            trace('ERROR: sync cleanup tasks did not complete successfully.');
            return Promise.resolve();
        });
    }
};

Call.prototype.onRemoteHangup = function() {
    // On remote hangup this client becomes the new initiator.
    this.params_.isInitiator = true;
    this.channel_.isInitiator_ = true;

    if (this.pcClient_) {
        this.pcClient_.close();
        this.pcClient_ = null;
    }

    //this.startSignaling_();
};

Call.prototype.startSignaling_ = function() {
    trace('Starting signaling.');
    if (this.params_.isInitiator && this.oncallerstarted) {
        var getPath = this.params_.roomServer + '/?id=' + this.params_.roomId;
        this.oncallerstarted(getPath);
    }

    this.createPcClient_()
        .then(function() {
            if (this.localStream_) {
                trace('Adding local stream.');
                this.pcClient_.addStream(this.localStream_);
            }
            if (this.params_.isInitiator) {
                this.pcClient_.startAsCaller(this.params_.offerOptions);
            } else {
                this.pcClient_.startAsCallee();
            }
        }.bind(this))
        .catch(function(e) {
            this.onError_('Create PeerConnection exception: ' + e);
            alert('Cannot create RTCPeerConnection: ' + e.message);
        }.bind(this));
};

Call.prototype.toggleVideoMute = function() {
    var videoTracks = this.localStream_.getVideoTracks();
    if (videoTracks.length === 0) {
        trace('No local video available.');
        return;
    }

    trace('Toggling video mute state.');
    for (var i = 0; i < videoTracks.length; ++i) {
        videoTracks[i].enabled = !videoTracks[i].enabled;
    }
    trace('Video ' + (videoTracks[0].enabled ? 'unmuted.' : 'muted.'));
};

Call.prototype.toggleAudioMute = function() {
    var audioTracks = this.localStream_.getAudioTracks();
    if (audioTracks.length === 0) {
        trace('No local audio available.');
        return;
    }

    trace('Toggling audio mute state.');
    for (var i = 0; i < audioTracks.length; ++i) {
        audioTracks[i].enabled = !audioTracks[i].enabled;
    }
    trace('Audio ' + (audioTracks[0].enabled ? 'unmuted.' : 'muted.'));
};

Call.prototype.onError_ = function(message) {
    if (this.onerror) {
        this.onerror(message);
    }
};