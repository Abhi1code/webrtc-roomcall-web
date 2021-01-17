var ChatBox = function(chatBoxDiv, uiConstants) {
    this.chatBoxDiv_ = chatBoxDiv;

    this.chatMsgInput_ = this.chatBoxDiv_.querySelector(uiConstants.msgerInput);
    this.msgerChat_ = this.chatBoxDiv_.querySelector(uiConstants.msgerChat);
    this.msgerForm_ = this.chatBoxDiv_.querySelector(uiConstants.msgerForm);

    this.sendListener_ = this.onsendButton_.bind(this);
    this.msgerForm_.addEventListener('submit', this.sendListener_);

    // Public callbacks. Keep it sorted.
    this.onsendMessage = null;
};

ChatBox.prototype.onsendButton_ = function(event) {
    event.preventDefault();

    const msgText = this.chatMsgInput_.value;
    if (!msgText) return;

    this.appendMessage_("right", msgText);
    this.chatMsgInput_.value = "";

    if (this.onsendMessage) {
        this.onsendMessage(msgText);
    }
};

ChatBox.prototype.msgReceived = function(msg) {
    this.appendMessage_("left", msg);
};

ChatBox.prototype.appendMessage_ = function(side, text) {
    //   Simple solution for small apps
    const msgHTML = `
    <div class="msg ${side}-msg">
      
      <div class="msg-bubble">
        
        <div class="msg-text">${text}</div>
      </div>
    </div>
  `;

    this.msgerChat_.insertAdjacentHTML("beforeend", msgHTML);
    this.msgerChat_.scrollTop += 300;
};

ChatBox.prototype.removeEventListeners = function() {
    this.msgerForm_.removeEventListener('submit', this.sendListener_);
};