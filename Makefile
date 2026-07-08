.PHONY: install uninstall build setup

install: setup
	bun link

uninstall:
	bun unlink glean

setup:
	bun install
	bun run setup

build:
	bun run build
