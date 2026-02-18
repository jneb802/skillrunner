---
name: hello-world
description: Create a hello.txt file to verify skillrunner works end-to-end
allowed-tools:
  - Write
  - Bash
---
Create a file called `hello.txt` in the current directory with the following contents:

```
Hello from skillrunner!
Generated at: <current date and time>
```

Use the Write tool to create the file, then use Bash to run `cat hello.txt` to confirm it was created.
