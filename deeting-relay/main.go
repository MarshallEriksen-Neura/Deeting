package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Relay configuration loaded from environment variables.
type RelayConfig struct {
    Addr                string
    SharedSecret        string
    FeishuCallbackSecret string
    FeishuAppID         string
    FeishuAppSecret     string
}

// RelayEvent represents a generic event that should be forwarded to a desktop agent.
type RelayEvent struct {
    ID        string          `json:"id"`
    Source    string          `json:"source"`
    Kind      string          `json:"kind"`
    ChatID    string          `json:"chat_id,omitempty"`
    Text      string          `json:"text,omitempty"`
    Raw       json.RawMessage `json:"raw,omitempty"`
    CreatedAt time.Time       `json:"created_at"`
}

// Agent represents a desktop client connected to the relay.
type Agent struct {
    ID        string
    Name      string
    CreatedAt time.Time
    LastSeen  time.Time
    Events    []*RelayEvent
}

// RelayState keeps a simple in-memory registry of agents and pending events.
type RelayState struct {
    mu     sync.Mutex
    agents map[string]*Agent
}

func NewRelayState() *RelayState {
    return &RelayState{agents: make(map[string]*Agent)}
}

func (s *RelayState) RegisterAgent(name string) *Agent {
    s.mu.Lock()
    defer s.mu.Unlock()
    id := randomID()
    now := time.Now().UTC()
    agent := &Agent{
        ID:        id,
        Name:      name,
        CreatedAt: now,
        LastSeen:  now,
        Events:    make([]*RelayEvent, 0),
    }
    s.agents[id] = agent
    return agent
}

func (s *RelayState) TouchAgent(id string) (*Agent, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    agent, ok := s.agents[id]
    if !ok {
        return nil, false
    }
    agent.LastSeen = time.Now().UTC()
    return agent, true
}

func (s *RelayState) EnqueueEvent(event *RelayEvent) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.agents) == 0 {
        return
    }
    for _, agent := range s.agents {
        agent.Events = append(agent.Events, event)
    }
}

func (s *RelayState) PullEvents(agentID string, max int) ([]*RelayEvent, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    agent, ok := s.agents[agentID]
    if !ok {
        return nil, errors.New("agent_not_found")
    }
    agent.LastSeen = time.Now().UTC()
    if len(agent.Events) == 0 {
        return []*RelayEvent{}, nil
    }
    if max <= 0 || max > len(agent.Events) {
        max = len(agent.Events)
    }
    events := agent.Events[:max]
    // shrink slice
    remaining := make([]*RelayEvent, len(agent.Events)-max)
    copy(remaining, agent.Events[max:])
    agent.Events = remaining
    return events, nil
}

// Feishu message reply client with simple in-memory token cache.
type FeishuClient struct {
    AppID     string
    AppSecret string

    mu          sync.Mutex
    accessToken string
    tokenExpire time.Time
}

func NewFeishuClient(appID, appSecret string) *FeishuClient {
    return &FeishuClient{AppID: appID, AppSecret: appSecret}
}

func (c *FeishuClient) getTenantAccessToken() (string, error) {
    c.mu.Lock()
    defer c.mu.Unlock()

    now := time.Now()
    if c.accessToken != "" && now.Before(c.tokenExpire) {
        return c.accessToken, nil
    }
    if c.AppID == "" || c.AppSecret == "" {
        return "", errors.New("feishu_app_not_configured")
    }

    body := map[string]string{
        "app_id":     c.AppID,
        "app_secret": c.AppSecret,
    }
    data, _ := json.Marshal(body)
    req, err := http.NewRequest(http.MethodPost, "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", strings.NewReader(string(data)))
    if err != nil {
        return "", err
    }
    req.Header.Set("Content-Type", "application/json; charset=utf-8")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return "", errors.New("feishu_auth_http_" + strconv.Itoa(resp.StatusCode))
    }
    var payload struct {
        Code            int    `json:"code"`
        Msg             string `json:"msg"`
        TenantToken     string `json:"tenant_access_token"`
        ExpireInSeconds int    `json:"expire"`
    }
    if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
        return "", err
    }
    if payload.Code != 0 || payload.TenantToken == "" {
        return "", errors.New("feishu_auth_code_" + strconv.Itoa(payload.Code))
    }
    ttl := payload.ExpireInSeconds
    if ttl <= 0 {
        ttl = 7200
    }
    c.accessToken = payload.TenantToken
    c.tokenExpire = now.Add(time.Duration(ttl-120) * time.Second)
    return c.accessToken, nil
}

func (c *FeishuClient) SendTextMessage(chatID, text string) error {
    token, err := c.getTenantAccessToken()
    if err != nil {
        return err
    }
    content, _ := json.Marshal(map[string]string{"text": text})
    body := map[string]any{
        "receive_id": chatID,
        "msg_type":   "text",
        "content":    string(content),
    }
    data, _ := json.Marshal(body)
    req, err := http.NewRequest(http.MethodPost, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", strings.NewReader(string(data)))
    if err != nil {
        return err
    }
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Content-Type", "application/json; charset=utf-8")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return errors.New("feishu_send_http_" + strconv.Itoa(resp.StatusCode))
    }
    var payload struct {
        Code int    `json:"code"`
        Msg  string `json:"msg"`
    }
    if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
        return err
    }
    if payload.Code != 0 {
        return errors.New("feishu_send_code_" + strconv.Itoa(payload.Code)+": "+payload.Msg)
    }
    return nil
}

// HTTP request / response models

type registerAgentRequest struct {
    Name string `json:"name"`
}

type registerAgentResponse struct {
    AgentID string `json:"agent_id"`
}

type pullEventsResponse struct {
    Events []*RelayEvent `json:"events"`
}

type replyEventRequest struct {
    ReplyText string `json:"reply_text"`
	ChatID    string `json:"chat_id,omitempty"`
}

// Helper to generate a simple random ID.
func randomID() string {
    const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
    b := make([]byte, 16)
    for i := range b {
        b[i] = letters[rand.Intn(len(letters))]
    }
    return string(b)
}

// Basic shared-secret auth for agent APIs.
func requireAgentAuth(cfg *RelayConfig, next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        secret := strings.TrimSpace(cfg.SharedSecret)
        if secret == "" {
            next(w, r)
            return
        }
        provided := strings.TrimSpace(r.Header.Get("X-Relay-Secret"))
        if provided == "" {
            http.Error(w, "missing relay secret", http.StatusUnauthorized)
            return
        }
        if !hmac.Equal([]byte(provided), []byte(secret)) {
            http.Error(w, "invalid relay secret", http.StatusUnauthorized)
            return
        }
        next(w, r)
    }
}

// Feishu event payload (simplified).
type feishuEventEnvelope struct {
    Type   string          `json:"type"`
    Schema string          `json:"schema"`
    Header json.RawMessage `json:"header"`
    Event  json.RawMessage `json:"event"`
}

type feishuEventHeader struct {
    EventType string `json:"event_type"`
    EventID   string `json:"event_id"`
}

type feishuMessageEvent struct {
    Message struct {
        MessageType string          `json:"message_type"`
        ChatID      string          `json:"chat_id"`
        Content     json.RawMessage `json:"content"`
    } `json:"message"`
}

func extractFeishuText(content json.RawMessage) string {
    if len(content) == 0 {
        return ""
    }
    var raw any
    if err := json.Unmarshal(content, &raw); err != nil {
        return string(content)
    }
    switch v := raw.(type) {
    case map[string]any:
        if textVal, ok := v["text"].(string); ok {
            return textVal
        }
    case string:
        // content might itself be a JSON string
        s := strings.TrimSpace(v)
        if s == "" {
            return ""
        }
        var inner map[string]any
        if err := json.Unmarshal([]byte(s), &inner); err == nil {
            if textVal, ok := inner["text"].(string); ok {
                return textVal
            }
        }
        return s
    }
    return ""
}

// Optional signature verification for Feishu callbacks.
func verifyFeishuSignature(cfg *RelayConfig, r *http.Request, body []byte) error {
    secret := strings.TrimSpace(cfg.FeishuCallbackSecret)
    if secret == "" {
        return nil
    }
    timestamp := strings.TrimSpace(r.Header.Get("X-Lark-Request-Timestamp"))
    if timestamp == "" {
        timestamp = strings.TrimSpace(r.Header.Get("X-Lark-Timestamp"))
    }
    nonce := strings.TrimSpace(r.Header.Get("X-Lark-Request-Nonce"))
    if nonce == "" {
        nonce = strings.TrimSpace(r.Header.Get("X-Lark-Nonce"))
    }
    signature := strings.TrimSpace(r.Header.Get("X-Lark-Signature"))
    if timestamp == "" || nonce == "" || signature == "" {
        return errors.New("missing_feishu_signature_headers")
    }

    payloads := []string{
        timestamp + nonce + string(body),
        timestamp + nonce + secret + string(body),
        timestamp + "\n" + nonce + "\n" + string(body),
    }
    candidates := make(map[string]struct{})
    for _, p := range payloads {
        mac := hmac.New(sha256.New, []byte(secret))
        mac.Write([]byte(p))
        digest := mac.Sum(nil)
        hexLower := strings.ToLower(fmt.Sprintf("%x", digest))
        candidates[hexLower] = struct{}{}
        b64 := base64.StdEncoding.EncodeToString(digest)
        candidates[b64] = struct{}{}
        urlSafe := strings.TrimRight(base64.URLEncoding.EncodeToString(digest), "=")
        candidates[urlSafe] = struct{}{}
    }
    if _, ok := candidates[signature]; ok {
        return nil
    }
    if _, ok := candidates[strings.ToLower(signature)]; ok {
        return nil
    }
    return errors.New("invalid_feishu_signature")
}

func main() {
    rand.Seed(time.Now().UnixNano())

    cfg := &RelayConfig{
        Addr:                 getenv("RELAY_HTTP_ADDR", ":8080"),
        SharedSecret:         os.Getenv("RELAY_SHARED_SECRET"),
        FeishuCallbackSecret: os.Getenv("FEISHU_CALLBACK_SECRET"),
        FeishuAppID:          os.Getenv("FEISHU_BOT_APP_ID"),
        FeishuAppSecret:      os.Getenv("FEISHU_BOT_APP_SECRET"),
    }

    state := NewRelayState()
    feishuClient := NewFeishuClient(cfg.FeishuAppID, cfg.FeishuAppSecret)

    mux := http.NewServeMux()

    // Agent registration.
    mux.HandleFunc("/agents/register", requireAgentAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
            http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
            return
        }
        var req registerAgentRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, "invalid_request_body", http.StatusBadRequest)
            return
        }
        name := strings.TrimSpace(req.Name)
        if name == "" {
            name = "default"
        }
        agent := state.RegisterAgent(name)
        writeJSON(w, http.StatusOK, registerAgentResponse{AgentID: agent.ID})
    }))

    // Agent pull pending events.
    mux.HandleFunc("/agents/", requireAgentAuth(cfg, func(w http.ResponseWriter, r *http.Request) {
        // Expect paths like /agents/{agent_id}/pull or /agents/{agent_id}/events/{event_id}/reply
        path := strings.TrimPrefix(r.URL.Path, "/agents/")
        parts := strings.Split(path, "/")
        if len(parts) < 2 {
            http.NotFound(w, r)
            return
        }
        agentID := parts[0]
        if parts[1] == "pull" {
            if r.Method != http.MethodGet {
                http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
                return
            }
            max := 0
            if v := r.URL.Query().Get("max"); v != "" {
                if n, err := strconv.Atoi(v); err == nil && n > 0 {
                    max = n
                }
            }
            events, err := state.PullEvents(agentID, max)
            if err != nil {
                http.Error(w, err.Error(), http.StatusNotFound)
                return
            }
            writeJSON(w, http.StatusOK, pullEventsResponse{Events: events})
            return
        }

        if len(parts) == 4 && parts[1] == "events" && parts[3] == "reply" {
            if r.Method != http.MethodPost {
                http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
                return
            }
            eventID := parts[2]
            _ = eventID // currently not used for lookup; kept for API clarity
            var req replyEventRequest
            if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
                http.Error(w, "invalid_request_body", http.StatusBadRequest)
                return
            }
            chatID := strings.TrimSpace(req.ChatID)
			if chatID == "" {
				http.Error(w, "missing_chat_id", http.StatusBadRequest)
				return
			}
			if strings.TrimSpace(req.ReplyText) == "" {
				http.Error(w, "missing_reply_text", http.StatusBadRequest)
				return
			}
			if err := feishuClient.SendTextMessage(chatID, req.ReplyText); err != nil {
                log.Printf("relay: failed to send Feishu reply: %v\n", err)
                http.Error(w, "feishu_send_failed", http.StatusBadGateway)
                return
            }
            writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
            return
        }

        http.NotFound(w, r)
    }))

    // Feishu event callback.
    mux.HandleFunc("/feishu/events", func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
            http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
            return
        }
        body, err := io.ReadAll(r.Body)
        if err != nil {
            http.Error(w, "read_body_failed", http.StatusBadRequest)
            return
        }
        // URL verification
        var probe struct {
            Type      string `json:"type"`
            Challenge string `json:"challenge"`
        }
        _ = json.Unmarshal(body, &probe)
        if probe.Type == "url_verification" && probe.Challenge != "" {
            writeJSON(w, http.StatusOK, map[string]string{"challenge": probe.Challenge})
            return
        }

        if err := verifyFeishuSignature(cfg, r, body); err != nil {
            log.Printf("relay: feishu signature verify failed: %v\n", err)
            http.Error(w, "invalid_signature", http.StatusUnauthorized)
            return
        }

        var envelope feishuEventEnvelope
        if err := json.Unmarshal(body, &envelope); err != nil {
            http.Error(w, "invalid_payload", http.StatusBadRequest)
            return
        }
        var header feishuEventHeader
        _ = json.Unmarshal(envelope.Header, &header)
        if header.EventType != "im.message.receive_v1" {
            writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
            return
        }
        var ev feishuMessageEvent
        if err := json.Unmarshal(envelope.Event, &ev); err != nil {
            http.Error(w, "invalid_event", http.StatusBadRequest)
            return
        }
        if strings.ToLower(ev.Message.MessageType) != "text" {
            writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
            return
        }
        chatID := strings.TrimSpace(ev.Message.ChatID)
        if chatID == "" {
            writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
            return
        }
        text := strings.TrimSpace(extractFeishuText(ev.Message.Content))
        if text == "" {
            writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
            return
        }

        eventID := header.EventID
        if eventID == "" {
            eventID = randomID()
        }

        relayEvent := &RelayEvent{
            ID:        eventID,
            Source:    "feishu",
            Kind:      "chat",
            ChatID:    chatID,
            Text:      text,
            Raw:       json.RawMessage(body),
            CreatedAt: time.Now().UTC(),
        }
        state.EnqueueEvent(relayEvent)
        writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
    })

    log.Printf("deeting-relay listening on %s\n", cfg.Addr)
    if err := http.ListenAndServe(cfg.Addr, mux); err != nil {
        log.Fatalf("server_error: %v", err)
    }
}

func getenv(key, def string) string {
    v := strings.TrimSpace(os.Getenv(key))
    if v == "" {
        return def
    }
    return v
}

func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.WriteHeader(status)
    if err := json.NewEncoder(w).Encode(v); err != nil {
        log.Printf("relay: writeJSON failed: %v\n", err)
    }
}
