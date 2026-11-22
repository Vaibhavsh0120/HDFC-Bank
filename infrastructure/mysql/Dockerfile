FROM mysql:8.4.13
# MySQL Shell is not used by Django or mysqld. Its bundled Python dependencies
# introduced critical findings in the upstream server image.
RUN microdnf remove -y mysql-shell \
    && microdnf upgrade -y \
    && microdnf clean all
