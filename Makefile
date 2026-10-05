.PHONY: install uninstall build setup

install: setup
	bun link

uninstall:
	bun unlink distill

setup:
	bun install
	bun run setup

build:
	bun run build
