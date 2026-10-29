
#ifndef _WIN32
#define _POSIX_C_SOURCE 200809L /* nanosleep(), isatty(), fileno() */
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdarg.h>

#ifdef _WIN32
#include <windows.h> /* Sleep(), console mode API */
#else
#include <unistd.h> /* isatty() */
#include <time.h>   /* nanosleep() */
#endif

/* ------------------------------------------------------------------
 * 1. Settings
 * ------------------------------------------------------------------ */
#define CAPACITY 8    /* fixed stack size              */
#define VALUE_LEN 16  /* longest value we can store    */
#define HISTORY_MAX 6 /* entries shown in the history  */
#define LADDER_W 9    /* width of the ladder column    */
#define BLOCK_W 20    /* width of the stack column     */
#define CLIMB_MS 75   /* pause between two ladder steps */
#define HOLD_MS 600   /* pause when the climber is on top */
#define AUTO_HOLD_MS 300 /* shorter pause while auto-playing */
#define AUTO_GAP_MS 160  /* pause between two auto steps      */

/* ANSI colour codes (only used when the terminal supports them) */
#define CLR_RESET "\033[0m"
#define CLR_BOLD "\033[1m"
#define CLR_DIM "\033[2m"
#define CLR_CYAN "\033[36m"
#define CLR_GREEN "\033[32m"
#define CLR_YELLOW "\033[33m"
#define CLR_RED "\033[31m"
#define CLR_WHITE "\033[37m"

static int g_ansi = 1; /* 0 = plain text output (no colour / no cursor moves) */

/* pause used by the climber: normal speed, or faster during an auto run */
static int g_hold_ms = HOLD_MS;

/* colour helper: returns "" when colours are switched off */
static const char *C(const char *code)
{
    return g_ansi ? code : "";
}

/* ------------------------------------------------------------------
 * 2. Tiny terminal helpers
 * ------------------------------------------------------------------ */
static void delay_ms(int ms)
{
#ifdef _WIN32
    Sleep((DWORD)ms);
#else
    struct timespec ts;
    ts.tv_sec = ms / 1000;
    ts.tv_nsec = (long)(ms % 1000) * 1000000L;
    nanosleep(&ts, NULL);
#endif
}

/* Turn colours/cursor control on only when we really have a terminal. */
static void setup_terminal(void)
{
#ifdef _WIN32
    DWORD mode = 0;
    HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
    if (h == INVALID_HANDLE_VALUE || !GetConsoleMode(h, &mode)) {
        g_ansi = 0; /* output is redirected -> plain text */
        return;
    }
    /* ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004 */
    if (!SetConsoleMode(h, mode | 0x0004))
        g_ansi = 0;
#else
    if (!isatty(fileno(stdout)))
        g_ansi = 0;
#endif
}

/* Move the cursor back to the top of the screen (no flicker). */
static void frame_begin(void)
{
    if (g_ansi)
        fputs("\033[H", stdout);
    else
        fputc('\n', stdout);
}

/* Wipe everything that is below the freshly drawn frame. */
static void frame_trim(void)
{
    if (g_ansi)
        fputs("\033[J", stdout);
}

/* ------------------------------------------------------------------
 * 3. The stack (real logic - index 0 is the bottom, `top` is the top)
 * ------------------------------------------------------------------ */
static char stack[CAPACITY][VALUE_LEN + 1];
static int top = -1; /* -1 means the stack is empty */

static int stack_size(void)
{
    return top + 1;
}

static int stack_is_empty(void)
{
    return top < 0;
}

static int stack_is_full(void)
{
    return top == CAPACITY - 1;
}

/* returns 1 on success, 0 on stack overflow */
static int stack_push(const char *value)
{
    if (stack_is_full())
        return 0;
    top++;
    strncpy(stack[top], value, VALUE_LEN);
    stack[top][VALUE_LEN] = '\0';
    return 1;
}

/* returns 1 on success, 0 on stack underflow */
static int stack_pop(char *out)
{
    if (stack_is_empty())
        return 0;
    strcpy(out, stack[top]); /* out must hold VALUE_LEN + 1 bytes */
    top--;
    return 1;
}

/* ------------------------------------------------------------------
 * 4. Status line + operation history
 * ------------------------------------------------------------------ */
static char status_msg[200] = "Ready - push a value to start.";
static char status_kind[16] = "ok";

static void set_status(const char *kind, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    vsnprintf(status_msg, sizeof status_msg, fmt, args);
    va_end(args);
    snprintf(status_kind, sizeof status_kind, "%s", kind);
}

static char history[HISTORY_MAX][110];
static int history_n = 0;

static void log_history(const char *text)
{
    int i;
    if (history_n < HISTORY_MAX) {
        snprintf(history[history_n], sizeof history[0], "%s", text);
        history_n++;
    } else {
        for (i = 1; i < HISTORY_MAX; i++)
            strcpy(history[i - 1], history[i]);
        snprintf(history[HISTORY_MAX - 1], sizeof history[0], "%s", text);
    }
}

/* ------------------------------------------------------------------
 * 5. Drawing one frame: header, ladder, stack, TOP pointer, history
 * ------------------------------------------------------------------ */
static void print_row(int r, int climber_row, const char *carry,
                      int hl_row, const char *hl_text)
{
    char ladder[32];
    char block[64];
    char mark[80];

    /* --- ladder column: either a rung or the little climber --- */
    if (r == climber_row)
        snprintf(ladder, sizeof ladder, "%s| (^_^) |%s",
                 C(CLR_YELLOW), C(CLR_RESET));
    else
        snprintf(ladder, sizeof ladder, "%s|=======|%s",
                 C(CLR_DIM), C(CLR_RESET));

    /* --- stack column: a value or an empty slot --- */
    if (r < 0)
        snprintf(block, sizeof block, "%*s", BLOCK_W, ""); /* ground row */
    else if (r > top)
        snprintf(block, sizeof block, "%s[%d] %-16s%s", C(CLR_DIM),
                 r, "(empty)", C(CLR_RESET));
    else
        snprintf(block, sizeof block, "[%d] %s%s%-16s%s", r,
                 C(CLR_BOLD), C(CLR_WHITE), stack[r], C(CLR_RESET));

    /* --- marker column: carries > highlight > TOP --- */
    if (r == climber_row && carry != NULL)
        snprintf(mark, sizeof mark, "%s<- holds \"%s\"%s",
                 C(CLR_YELLOW), carry, C(CLR_RESET));
    else if (r >= 0 && r == hl_row && hl_text != NULL)
        snprintf(mark, sizeof mark, "%s<== %s%s", C(CLR_GREEN),
                 hl_text, C(CLR_RESET));
    else if (r >= 0 && r == top)
        snprintf(mark, sizeof mark, "%s<== TOP%s", C(CLR_CYAN), C(CLR_RESET));
    else
        mark[0] = '\0';

    printf("  %s  %s  %s\n", ladder, block, mark);
}

/* Draws the whole screen. The cursor is first sent home, the frame is
 * printed and everything left over below it is erased. */
static void render_frame(int climber_row, const char *carry,
                         int hl_row, const char *hl_text, const char *phase)
{
    int r;
    int i;

    frame_begin();

    printf("\n  %sStackLab%s - Stack Data Structure Visualizer (C)\n",
           C(CLR_BOLD), C(CLR_RESET));
    printf("  %sLIFO  |  capacity %d  |  push = pop = peek = O(1)%s\n",
           C(CLR_CYAN), CAPACITY, C(CLR_RESET));
    printf("  stack size:  %s%d / %d%s\n", C(CLR_BOLD), stack_size(),
           CAPACITY, C(CLR_RESET));

    if (strcmp(status_kind, "error") == 0)
        printf("  %s[ fail ]%s %s\n", C(CLR_RED), C(CLR_RESET), status_msg);
    else if (strcmp(status_kind, "warn") == 0)
        printf("  %s[ warn ]%s %s\n", C(CLR_YELLOW), C(CLR_RESET), status_msg);
    else
        printf("  %s[  ok  ]%s %s\n", C(CLR_GREEN), C(CLR_RESET), status_msg);

    if (phase != NULL)
        printf("  %s.. %s%s\n", C(CLR_DIM), phase, C(CLR_RESET));

    /* column titles */
    printf("\n  %s%-*s  %-*s  %s%s\n", C(CLR_DIM), LADDER_W, "LADDER",
           BLOCK_W, "STACK", "MARK", C(CLR_RESET));

    /* rows are printed from the top (index 7) down to the ground */
    for (r = CAPACITY - 1; r >= -1; r--) {
        print_row(r, climber_row, carry, hl_row, hl_text);
        if (r == 0) /* the floor under the stack */
            printf("  %*s  %s%s%s\n", LADDER_W, "", C(CLR_DIM),
                   "+------------------+", C(CLR_RESET));
    }

    /* operation history */
    printf("\n  %soperation history (newest first)%s\n",
           C(CLR_DIM), C(CLR_RESET));
    if (history_n == 0)
        printf("    (nothing yet)\n");
    else
        for (i = 0; i < history_n; i++)
            printf("    %s\n", history[i]);

    frame_trim();
    fflush(stdout);
}

/* ------------------------------------------------------------------
 * 6. Animation: the climber walks rung by rung from -> to
 * ------------------------------------------------------------------ */
static void climb(int from, int to, const char *carry, const char *phase,
                  int hl_row, const char *hl_text)
{
    int step = (to >= from) ? 1 : -1;
    int r = from;

    for (;;) {
        render_frame(r, carry, hl_row, hl_text, phase);
        delay_ms(CLIMB_MS);
        if (r == to)
            break;
        r += step;
    }
}

/* PUSH: carry the value up the ladder, drop it on top, walk back. */
static void do_push(const char *value)
{
    int target = stack_size(); /* the row the value will occupy */

    set_status("ok", "Push: carrying \"%s\" up the ladder ...", value);
    climb(-1, target, value, "climbing up to the top", -1, NULL);

    stack_push(value); /* O(1) - simply stored at the top index */
    render_frame(target, NULL, target, "NEW",
                 "placing the element on top of the stack");
    delay_ms(g_hold_ms);

    climb(target, -1, NULL, "climbing back down", -1, NULL);

    set_status("ok", "Pushed \"%s\" - new top is \"%s\".", value, stack[top]);

    char entry[110];
    snprintf(entry, sizeof entry, "push(\"%s\") -> size %d", value,
             stack_size());
    log_history(entry);
}

/* POP: climb up, take the top element off, carry it back down. */
static void do_pop(void)
{
    char removed[VALUE_LEN + 1];
    char entry[110];
    int target = top;

    set_status("ok", "Pop: climbing up to the top ...");
    climb(-1, target, NULL, "climbing up to the top", -1, NULL);

    stack_pop(removed); /* O(1) - only the top element is removed */
    render_frame(target, removed, -1, NULL,
                 "taking the element out of the stack");
    delay_ms(g_hold_ms);

    climb(target, -1, removed, "carrying it back down", -1, NULL);

    if (stack_is_empty())
        set_status("ok", "Popped \"%s\" - the stack is now empty.", removed);
    else
        set_status("ok", "Popped \"%s\" - new top is \"%s\".", removed,
                   stack[top]);

    snprintf(entry, sizeof entry, "pop() -> removed \"%s\"", removed);
    log_history(entry);
}

/* PEEK: climb up, read the top element, climb down again. */
static void do_peek(void)
{
    char entry[110];
    int target = top;

    set_status("ok", "Peek: climbing up to read the top ...");
    climb(-1, target, NULL, "climbing up to the top", -1, NULL);

    render_frame(target, NULL, target, "PEEK", "reading the top element");
    delay_ms(HOLD_MS);

    climb(target, -1, NULL, "climbing back down", -1, NULL);

    set_status("ok", "Top element is \"%s\" - stack size is %d.", stack[target],
               stack_size());

    snprintf(entry, sizeof entry, "peek() -> \"%s\"", stack[target]);
    log_history(entry);
}

/* ------------------------------------------------------------------
 * 7. Auto demo: run the whole sequence by itself
 * ------------------------------------------------------------------ */
/* AUTO PUSH: keeps pushing 1, 2, 3 ... until the stack overflows. */
static void do_auto_push(void)
{
    char value[VALUE_LEN + 1];

    g_hold_ms = AUTO_HOLD_MS; /* a little faster than manual mode */

    while (!stack_is_full()) {
        snprintf(value, sizeof value, "%d", stack_size() + 1);
        do_push(value);
        if (!stack_is_full())
            delay_ms(AUTO_GAP_MS);
    }

    g_hold_ms = HOLD_MS;

    set_status("error", "Stack overflow - the stack is full (%d / %d).",
               CAPACITY, CAPACITY);
    log_history("auto push -> overflow");
}

/* AUTO POP: keeps popping until the stack underflows. */
static void do_auto_pop(void)
{
    g_hold_ms = AUTO_HOLD_MS;

    while (!stack_is_empty()) {
        do_pop();
        if (!stack_is_empty())
            delay_ms(AUTO_GAP_MS);
    }

    g_hold_ms = HOLD_MS;

    set_status("error", "Stack underflow - the stack is empty (0 / %d).",
               CAPACITY);
    log_history("auto pop -> underflow");
}

/* ------------------------------------------------------------------
 * 8. Help screen (LIFO + time complexity)
 * ------------------------------------------------------------------ */
static void print_help(void)
{
    printf("\n  %sLIFO - Last In, First Out%s\n", C(CLR_BOLD), C(CLR_RESET));
    printf("  A stack is a linear structure where insertion and deletion\n");
    printf("  both happen at one end called the TOP. The element added\n");
    printf("  last is removed first - like a stack of plates: you always\n");
    printf("  lift the top plate, never one from the middle.\n");
    printf("\n  %sTime complexity%s\n", C(CLR_BOLD), C(CLR_RESET));
    printf("    %-8s %sO(1)%s   adds a value at the top index\n", "Push",
           C(CLR_CYAN), C(CLR_RESET));
    printf("    %-8s %sO(1)%s   removes the top element only\n", "Pop",
           C(CLR_CYAN), C(CLR_RESET));
    printf("    %-8s %sO(1)%s   reads one known position: the top\n", "Peek",
           C(CLR_CYAN), C(CLR_RESET));
    printf("\n  %sStack overflow%s  - Push is called while the stack is full (%d).\n",
           C(CLR_RED), C(CLR_RESET), CAPACITY);
    printf("  %sStack underflow%s - Pop or Peek is called on an empty stack.\n",
           C(CLR_RED), C(CLR_RESET));
    printf("\n  %sAuto demo%s\n", C(CLR_BOLD), C(CLR_RESET));
    printf("    menu 4 keeps pushing 1, 2, 3 ... until the stack overflows.\n");
    printf("    menu 5 keeps popping until the stack underflows.\n");
    printf("\n  %sCapacity of this stack: %d elements.%s\n", C(CLR_YELLOW),
           CAPACITY, C(CLR_RESET));
}

static void print_menu(void)
{
    printf("\n  %s----------------------------------------------------%s\n",
           C(CLR_DIM), C(CLR_RESET));
    printf("   [1] Push   [2] Pop   [3] Peek   [4] Auto Push\n");
    printf("   [5] Auto Pop   [6] Help   [7] Exit\n");
    printf("  %schoice> %s", C(CLR_CYAN), C(CLR_RESET));
    fflush(stdout);
}

/* ------------------------------------------------------------------
 * 9. Input helpers (fgets - no buffer overflow, no scanf surprises)
 * ------------------------------------------------------------------ */
/* Reads one line. Returns 0 on end of input (Ctrl+D / Ctrl+Z). */
static int read_line(char *buf, size_t size)
{
    size_t n;

    if (fgets(buf, (int)size, stdin) == NULL)
        return 0;

    n = strlen(buf);
    if (n > 0 && buf[n - 1] == '\n')
        buf[n - 1] = '\0';
    else {
        int c;
        while ((c = getchar()) != '\n' && c != EOF) /* drop the rest */
            ;
    }
    return 1;
}

/* Removes leading and trailing blanks. */
static void trim(char *s)
{
    char *p = s;
    size_t n;

    while (*p != '\0' && isspace((unsigned char)*p))
        p++;
    if (p != s)
        memmove(s, p, strlen(p) + 1);

    n = strlen(s);
    while (n > 0 && isspace((unsigned char)s[n - 1]))
        s[--n] = '\0';
}

/* ------------------------------------------------------------------
 * 10. Main loop
 * ------------------------------------------------------------------ */
int main(void)
{
    char choice[16];
    char value[64];
    char entry[110];
    int running = 1;

    setup_terminal();

    /* short introduction (also available later through menu 6) */
    print_help();
    printf("\n  %sPress Enter to start the visualizer ...%s",
           C(CLR_DIM), C(CLR_RESET));
    fflush(stdout);
    if (!read_line(choice, sizeof choice))
        running = 0;

    while (running) {
        render_frame(-1, NULL, -1, NULL, "ready");
        print_menu();

        if (!read_line(choice, sizeof choice))
            break;
        trim(choice);

        if (choice[0] == '\0' || strlen(choice) > 1) {
            set_status("warn", "Invalid input - choose a number from 1 to 7.");
            log_history("menu -> invalid input");
            continue;
        }

        switch (choice[0]) {
        case '1': /* ---------------- PUSH ---------------- */
            printf("  %svalue> %s", C(CLR_CYAN), C(CLR_RESET));
            fflush(stdout);
            if (!read_line(value, sizeof value))
                break;
            trim(value);

            if (value[0] == '\0') {
                set_status("warn", "Invalid input - type a value first.");
                log_history("push() -> invalid input");
                break;
            }
            if (strlen(value) > VALUE_LEN) {
                set_status("warn", "Invalid input - max %d characters.",
                           VALUE_LEN);
                log_history("push() -> invalid input");
                break;
            }
            if (stack_is_full()) {
                set_status("error",
                           "Stack overflow - capacity is %d. Pop a value first.",
                           CAPACITY);
                snprintf(entry, sizeof entry, "push(\"%s\") -> overflow",
                         value);
                log_history(entry);
                break;
            }
            do_push(value);
            break;

        case '2': /* ---------------- POP ----------------- */
            if (stack_is_empty()) {
                set_status("error", "Stack underflow - nothing to pop.");
                log_history("pop() -> underflow");
                break;
            }
            do_pop();
            break;

        case '3': /* ---------------- PEEK ---------------- */
            if (stack_is_empty()) {
                set_status("error",
                           "Stack underflow - the stack is empty.");
                log_history("peek() -> underflow");
                break;
            }
            do_peek();
            break;

        case '4': /* ---------------- AUTO PUSH ------ */
            if (stack_is_full()) {
                set_status("error", "Stack overflow - the stack is full (%d / %d).",
                           CAPACITY, CAPACITY);
                log_history("auto push -> overflow");
                break;
            }
            do_auto_push();
            break;

        case '5': /* ---------------- AUTO POP ------- */
            if (stack_is_empty()) {
                set_status("error",
                           "Stack underflow - the stack is empty (0 / %d).",
                           CAPACITY);
                log_history("auto pop -> underflow");
                break;
            }
            do_auto_pop();
            break;

        case '6': /* ---------------- HELP ---------------- */
            printf("\n");
            print_help();
            printf("\n  %sPress Enter to go back ...%s", C(CLR_DIM),
                   C(CLR_RESET));
            fflush(stdout);
            read_line(choice, sizeof choice);
            break;

        case '7': /* ---------------- EXIT ---------------- */
            running = 0;
            break;

        default:
            set_status("warn", "Invalid input - choose a number from 1 to 7.");
            log_history("menu -> invalid input");
            break;
        }
    }

    printf("\n  %sBye! Stack size was %d / %d.%s\n\n", C(CLR_CYAN),
           stack_size(), CAPACITY, C(CLR_RESET));
    return 0;
}
